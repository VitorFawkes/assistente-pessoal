import { getOwnerSlug, isOwner } from "./owner-slug";
// Grava as tarefas de uma reunião já comparando com as que existem.
//
// Quem chama é o n8n (rota /api/admin/tarefas/incorporar), no lugar do INSERT
// direto que ele fazia. Regras (a comparação em si mora em tarefas-repetidas.ts):
//
// - Comparação com reuniões anteriores: só pra quem tem users.dedup_tarefas_desde
//   preenchido. Desligada, a tarefa nasce como sempre nasceu.
// - Gravação longa fatiada: quando a reunião é uma PARTE e a IA diz (3 de 3) que a
//   tarefa é a mesma de uma tarefa da gravação inteira, a da parte fica e a da
//   gravação inteira sai (cancelada com motivo, não apagada). Vale sempre, mesmo
//   com a comparação desligada. Tarefa da gravação inteira que você já mexeu
//   (quadro, edição, plano, anexo, combinado do coach) não sai: a parte vira
//   "falada de novo" nela.
// - Qualquer falha na comparação → a tarefa nasce normal. Nunca se perde tarefa.
// - Ações da equipe (TTARS, 01/10/2026, pedido do Vitor: "a partir das reuniões não fique toda hora criando
//   tarefa que já existia"): a comparação vale para todo mundo, sem depender de users.dedup_tarefas_desde, e
//   olha também ações de OUTRAS pessoas que a reunião pode estar repetindo (candidatasDaEquipe). Quando a
//   repetida é de outra pessoa, a fala vira "falada de novo" na ação dela (sem mexer no prazo) e quem gravou
//   passa a ver essa ação; a dúvida com ação de outra pessoa nasce como tarefa normal.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTenant, withTenantLeituraEquipe } from "./db";
import { recordAiUsage } from "./ai-usage";
import { requestCostUsd } from "./coach/pricing";
import { isTeamMode } from "./team-mode";
import {
  compararComExistentes,
  vetorizar,
  textoParaVetor,
  hashTexto,
  modeloDoJuiz,
  MODELO_VETOR,
  DIAS_CONCLUIDA,
  type Candidata,
  type Decisao,
  type Exemplo,
  type Juiz,
} from "./tarefas-repetidas";

export type TarefaExtraida = {
  titulo: string;
  descricao?: string | null;
  owner?: string | null;
  acao?: string | null;
  prazo?: string | null;
  prazo_text?: string | null;
  prioridade?: string | null;
  evidencia?: string | null;
  area_raw?: string | null;
  pessoas_raw?: string | string[] | null;
  precisa_revisao?: boolean | null;
};

export type ResultadoIncorporacao = {
  criadas: {
    id: string;
    titulo: string;
    owner: string;
    prazo: string | null;
    prioridade: string;
    parece_com_id: string | null;
  }[];
  juntadas: { tarefa_id: string; titulo_existente: string; titulo_falado: string; prazo_mudou: boolean }[];
  substituidas: { antiga_id: string; nova_id: string; titulo: string }[];
  ignoradas: number;
  comparacao: "ligada" | "so_gravacao_fatiada" | "desligada" | "falhou";
  aviso?: string;
};

const ABERTAS = ["aberta", "em_andamento", "aguardando_aprovacao"];
const PRIORIDADES = ["baixa", "media", "alta", "urgente"];
const ACOES = ["executar", "cobrar", "aguardar"];

export function normalizarTitulo(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function limpar(t: TarefaExtraida) {
  const owner = (t.owner ?? "").trim() || getOwnerSlug();
  const ehVitor = isOwner(owner);
  const acao = ACOES.includes(String(t.acao)) ? String(t.acao) : ehVitor ? "executar" : "cobrar";
  let pessoas: string | null = null;
  if (Array.isArray(t.pessoas_raw)) pessoas = JSON.stringify(t.pessoas_raw);
  else if (typeof t.pessoas_raw === "string" && t.pessoas_raw.trim().startsWith("[")) pessoas = t.pessoas_raw;
  return {
    titulo: t.titulo.trim(),
    descricao: t.descricao?.trim() || null,
    owner: ehVitor ? getOwnerSlug() : owner,
    acao,
    prazo: t.prazo || null,
    prazo_text: t.prazo_text?.trim() || null,
    prioridade: PRIORIDADES.includes(String(t.prioridade)) ? String(t.prioridade) : "media",
    evidencia: t.evidencia?.trim() || null,
    area_raw: t.area_raw?.trim() || null,
    pessoas_raw: pessoas,
    precisa_revisao: !!t.precisa_revisao,
  };
}
type Limpa = ReturnType<typeof limpar>;

/** Candidata com o dono da linha (quem criou): na equipe pode ser outra pessoa. `comQuemGravou`: ação de outra
 *  pessoa que já é feita por quem gravou (passada a ele ou ele também faz). */
type Cand = Candidata & { meeting_id: string | null; dono_id: string; comQuemGravou?: boolean };

type Contexto = {
  reuniaoEm: string | null;
  /** A reunião de quem gravou está em "Só eu": nada dela vai para ação de outra pessoa. */
  soEu: boolean;
  /** Fim da reunião (começo + duração), para achar outra gravação do mesmo horário. */
  reuniaoFim: string | null;
  paiId: string | null;
  ligada: boolean;
  titulosJaNaReuniao: Set<string>;
  candidatas: Cand[];
  exemplos: Exemplo[];
};

async function lerContexto(
  c: PoolClient,
  userId: string,
  meetingId: string,
  reprocessar: boolean,
): Promise<Contexto> {
  const m = (
    await c.query<{ reuniao_em: string | null; duracao: number | null; parent_meeting_id: string | null; so_eu: boolean }>(
      `SELECT COALESCE(recorded_at, created_at) AS reuniao_em, duration_seconds AS duracao, parent_meeting_id,
              COALESCE(to_jsonb(meetings) ->> 'visibilidade', '') = 'so_eu' AS so_eu
         FROM meetings WHERE id = $1`,
      [meetingId],
    )
  ).rows[0];
  if (!m) throw new Error("reunião não encontrada");
  const u = (
    await c.query<{ desde: string | null }>(`SELECT dedup_tarefas_desde AS desde FROM users WHERE id = $1`, [userId])
  ).rows[0];
  // Na equipe a comparação vale para todo mundo (01/10/2026); no Ações pessoal, só para quem ligou.
  const ligada = isTeamMode() || !!u?.desde;

  // O que esta reunião já gravou (card ou "falada de novo"): reenvio não refaz.
  // Reprocessando, as menções desta reunião são refeitas do zero — não contam.
  const ja = await c.query<{ titulo: string }>(
    `SELECT titulo FROM tarefas WHERE meeting_id = $1
     UNION ALL
     SELECT titulo_falado FROM tarefa_mencoes WHERE meeting_id = $1 AND origem = 'reuniao' AND NOT $2`,
    [meetingId, reprocessar],
  );
  const titulosJaNaReuniao = new Set(ja.rows.map((r) => normalizarTitulo(r.titulo)));

  let candidatas: Contexto["candidatas"] = [];
  // Na equipe o n8n refaz a reunião sem avisar que é reprocesso (renomear quem falou): as ações desta reunião que
  // sobraram (passadas, com fala de outra reunião, marcadas para alguém) também contam, senão nasceriam de novo.
  const todas = ligada && (reprocessar || isTeamMode());
  if (ligada || m.parent_meeting_id) {
    const r = await c.query<{
      id: string;
      titulo: string;
      descricao: string | null;
      owner: string | null;
      status: string;
      criada_em: string;
      concluida_em: string | null;
      reuniao_em: string | null;
      meeting_id: string | null;
    }>(
      `SELECT t.id, t.titulo, t.descricao, t.owner, t.status, t.meeting_id,
              t.created_at AS criada_em, t.concluida_em,
              COALESCE(mt.recorded_at, mt.created_at) AS reuniao_em
         FROM tarefas t LEFT JOIN meetings mt ON mt.id = t.meeting_id
        WHERE t.user_id = $1
          AND (t.status = ANY($2::text[])
               OR (t.status = 'concluida' AND t.concluida_em >= COALESCE($3::timestamptz, now()) - make_interval(days => $4)))
          AND ${
            ligada
              ? // reprocessando: as que sobraram desta reunião (feitas ou criadas na mão) também contam
                todas
                ? "TRUE"
                : "t.meeting_id IS DISTINCT FROM $5"
              : // desligada: só a gravação inteira de quem é parte (fatiada)
                "t.meeting_id = $5 AND t.status = ANY($2::text[])"
          }`,
      todas
        ? [userId, ABERTAS, m.reuniao_em, DIAS_CONCLUIDA]
        : [userId, ABERTAS, m.reuniao_em, DIAS_CONCLUIDA, ligada ? meetingId : m.parent_meeting_id],
    );
    candidatas = r.rows.map((x) => ({
      ...x,
      dono_id: userId,
      criada_em: new Date(x.criada_em).toISOString(),
      concluida_em: x.concluida_em ? new Date(x.concluida_em).toISOString() : null,
      reuniao_em: x.reuniao_em ? new Date(x.reuniao_em).toISOString() : null,
    }));
  } else if (reprocessar) {
    // Refazendo sem a comparação ligada: a ação desta reunião que ficou porque está com alguém
    // (puxada ou passada) é comparada, para a mesma ação não nascer de novo com outras palavras.
    const r = await c.query<{
      id: string;
      titulo: string;
      descricao: string | null;
      owner: string | null;
      status: string;
      criada_em: string;
      concluida_em: string | null;
      reuniao_em: string | null;
      meeting_id: string | null;
    }>(
      `SELECT t.id, t.titulo, t.descricao, t.owner, t.status, t.meeting_id,
              t.created_at AS criada_em, t.concluida_em,
              COALESCE(mt.recorded_at, mt.created_at) AS reuniao_em
         FROM tarefas t LEFT JOIN meetings mt ON mt.id = t.meeting_id
        WHERE t.user_id = $1 AND t.meeting_id = $2 AND t.status = ANY($3::text[])
          AND t.responsavel_user_id IS NOT NULL`,
      [userId, meetingId, ABERTAS],
    );
    candidatas = r.rows.map((x) => ({
      ...x,
      dono_id: userId,
      criada_em: new Date(x.criada_em).toISOString(),
      concluida_em: x.concluida_em ? new Date(x.concluida_em).toISOString() : null,
      reuniao_em: x.reuniao_em ? new Date(x.reuniao_em).toISOString() : null,
    }));
  }

  const fb = await c.query<{ tipo: "repetida" | "diferente"; payload: { nova?: { titulo?: string }; existente?: { titulo?: string } } }>(
    `SELECT tipo, payload FROM extracao_feedback
      WHERE user_id = $1 AND tipo IN ('repetida','diferente')
      ORDER BY created_at DESC LIMIT 12`,
    [userId],
  );
  const exemplos: Exemplo[] = fb.rows
    .filter((r) => r.payload?.nova?.titulo && r.payload?.existente?.titulo)
    .map((r) => ({ tipo: r.tipo, nova: r.payload.nova!.titulo!, existente: r.payload.existente!.titulo! }));

  const inicio = m.reuniao_em ? new Date(m.reuniao_em) : null;
  return {
    reuniaoEm: inicio ? inicio.toISOString() : null,
    soEu: !!m.so_eu,
    reuniaoFim: inicio ? new Date(inicio.getTime() + Math.max(0, Number(m.duracao) || 0) * 1000).toISOString() : null,
    paiId: m.parent_meeting_id,
    ligada,
    titulosJaNaReuniao,
    candidatas,
    exemplos,
  };
}

/** Palavras do nome, sem acento ("Tiago Abdul" → tiago, abdul). */
const palavrasDoNome = (s: string | null | undefined) => normalizarTitulo(s ?? "").split(" ").filter(Boolean);

/** O nome dito (ou dado a uma voz) é o desta pessoa? Mesmo primeiro nome e as outras palavras na ordem do nome
 *  completo: "Tiago Abdul" é "Tiago de Mello Abdul Hak". */
function nomeBate(dito: string, nome: string): boolean {
  const d = palavrasDoNome(dito);
  const n = palavrasDoNome(nome);
  if (!d.length || d[0] !== n[0]) return false;
  let j = 0;
  for (const w of n) if (j < d.length && w === d[j]) j++;
  return j === d.length;
}

/** De quem é o nome: a ÚNICA pessoa da equipe com quem ele bate ("Ana", com duas Anas, é de ninguém). */
export function pessoaDoNome(dito: string, pessoas: { id: string; nome: string }[]): string | null {
  const achadas = pessoas.filter((p) => nomeBate(dito, p.nome));
  return achadas.length === 1 ? achadas[0].id : null;
}

/** Os nomes dados às vozes de uma reunião ({"A": "Tiago Abdul", "B": "Vitor"}). */
function nomesDasVozes(vozes: unknown): string[] {
  if (!vozes || typeof vozes !== "object" || Array.isArray(vozes)) return [];
  return Object.values(vozes as Record<string, unknown>).filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/**
 * "A mesma reunião" gravada por outra pessoa: começou até 15 min antes ou depois desta E as duas se cruzam em pelo
 * menos metade da mais curta. Reunião encostada (uma termina, a outra começa) não conta. Sem a duração de alguma das
 * duas, vale só o começo, com até 10 min de diferença. $2 = começo desta, $3 = fim, $4 = duração (s).
 */
const MESMA_REUNIAO = `abs(extract(epoch FROM (COALESCE(m.recorded_at, m.created_at) - $2::timestamptz))) <= 900
       AND (CASE WHEN COALESCE(m.duration_seconds, 0) = 0 OR $4::int = 0
                 THEN abs(extract(epoch FROM (COALESCE(m.recorded_at, m.created_at) - $2::timestamptz))) <= 600
                 ELSE extract(epoch FROM (LEAST(COALESCE(m.recorded_at, m.created_at) + make_interval(secs => m.duration_seconds), $3::timestamptz)
                                          - GREATEST(COALESCE(m.recorded_at, m.created_at), $2::timestamptz)))
                      >= 0.5 * LEAST(m.duration_seconds, $4::int) END)`;

type Par = { tarefa_id: string; dono_id: string };

/**
 * Equipe: ações de OUTRAS pessoas que a reunião nova pode estar repetindo.
 *   - as que passaram ou marcaram para quem gravou (ela já tem a ação na lista);
 *   - as de outra gravação da MESMA reunião (MESMA_REUNIAO), com a prova vinda da gravação da OUTRA pessoa:
 *     (a) a reunião dela chama quem gravou (equipe_chamado_na_reuniao: convite, voz ou "estava" marcados nela; "Só
 *     eu" fora); (b) a reunião dela dá nome à voz de quem gravou (a voz de uma pessoa só da equipe). Ex.: 29/09,
 *     "Weddings" no Teams da Diana tem a voz "Tiago Abdul"; "Plano Weddings" é a gravação do Tiago no celular.
 * O que quem gravou marcou na reunião DELE (voz com o nome de alguém, "estava") só diz em quem procurar, nunca abre a
 * ação de ninguém (revisão de 01/10/2026). Só ações abertas, sem pedido ao marketing e sem Notion. Volta também os
 * títulos que esta reunião já juntou em ações dessas pessoas (o reenvio não junta nem cria de novo).
 */
export async function candidatasDaEquipe(
  userId: string,
  meetingId: string,
  inicio: Date,
  fim: Date,
): Promise<{ candidatas: Cand[]; jaJuntados: Set<string> }> {
  const duracao = Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 1000));
  const horario = [inicio.toISOString(), fim.toISOString(), duracao];
  const { pares, procurar } = await withTenantLeituraEquipe(userId, async (c) => {
    const minhas = await c.query<Par>(
      `SELECT tarefa_id::text AS tarefa_id, dono_id::text AS dono_id FROM equipe_tarefas_para_mim()
       UNION
       SELECT tarefa_id::text, dono_id::text FROM equipe_tarefas_marcadas_para_mim()`,
    );
    const mesmas = await c.query<Par>(
      `SELECT t.id::text AS tarefa_id, t.user_id::text AS dono_id
         FROM meetings m JOIN tarefas t ON t.meeting_id = m.id
        WHERE m.user_id <> $1 AND ${MESMA_REUNIAO} AND equipe_chamado_na_reuniao(m.id)`,
      [userId, ...horario],
    );
    // Quem estava nesta reunião pelo que quem gravou registrou: só diz em quem procurar a outra gravação.
    const f = await c.query<{ id: string }>(
      `SELECT DISTINCT user_id::text AS id FROM meeting_acessos
        WHERE meeting_id = $1 AND user_id IS NOT NULL AND user_id <> $2 AND motivo <> 'quem_ve'`,
      [meetingId, userId],
    );
    return { pares: [...minhas.rows, ...mesmas.rows], procurar: f.rows.map((x) => x.id) };
  });
  if (procurar.length) {
    const pessoas = await query<{ id: string; nome: string }>(
      `SELECT id::text AS id, nome FROM users WHERE deleted_at IS NULL AND COALESCE(nome, '') <> ''`,
    );
    for (const pessoa of procurar) {
      const r = await withTenant(pessoa, async (c) => {
        const reunioes = (
          await c.query<{ id: string; vozes: unknown }>(
            `SELECT m.id::text AS id, m.speaker_labels AS vozes FROM meetings m
              WHERE m.user_id = $1 AND m.visibilidade <> 'so_eu' AND ${MESMA_REUNIAO}`,
            [pessoa, ...horario],
          )
        ).rows
          .filter((m) => nomesDasVozes(m.vozes).some((n) => pessoaDoNome(n, pessoas) === userId))
          .map((m) => m.id);
        if (!reunioes.length) return [];
        return (
          await c.query<Par>(
            `SELECT id::text AS tarefa_id, user_id::text AS dono_id FROM tarefas WHERE meeting_id = ANY($1::uuid[]) AND user_id = $2`,
            [reunioes, pessoa],
          )
        ).rows;
      });
      pares.push(...r);
    }
  }

  const porDono = new Map<string, Set<string>>();
  for (const x of pares) {
    if (x.dono_id === userId) continue; // as de quem gravou já entraram pelo caminho de sempre
    if (!porDono.has(x.dono_id)) porDono.set(x.dono_id, new Set());
    porDono.get(x.dono_id)!.add(x.tarefa_id);
  }
  const jaJuntados = new Set<string>();
  if (!porDono.size) return { candidatas: [], jaJuntados };
  const t = await query<{ pedidos: boolean; notion: boolean }>(
    `SELECT to_regclass('tarefa_pedidos') IS NOT NULL AS pedidos, to_regclass('notion_paginas') IS NOT NULL AS notion`,
  );
  const fora = [
    t[0]?.pedidos ? "AND NOT EXISTS (SELECT 1 FROM tarefa_pedidos tp WHERE tp.tarefa_id = t.id)" : "",
    t[0]?.notion ? "AND NOT EXISTS (SELECT 1 FROM notion_paginas np WHERE np.tarefa_id = t.id)" : "",
  ].join(" ");
  const grupos = await Promise.all(
    [...porDono.entries()].map(([dono, ids]) =>
      withTenant(dono, async (c) => {
        const r = await c.query<{
          id: string;
          titulo: string;
          descricao: string | null;
          owner: string | null;
          status: string;
          meeting_id: string | null;
          criada_em: string;
          concluida_em: string | null;
          reuniao_em: string | null;
          com_quem_gravou: boolean;
        }>(
          `SELECT t.id::text AS id, t.titulo, t.descricao, t.owner, t.status, t.meeting_id::text AS meeting_id,
                  t.created_at AS criada_em, t.concluida_em, COALESCE(mt.recorded_at, mt.created_at) AS reuniao_em,
                  (t.responsavel_user_id = $4::uuid
                   OR EXISTS (SELECT 1 FROM tarefa_acessos ta WHERE ta.tarefa_id = t.id AND ta.user_id = $4::uuid AND ta.faz)) AS com_quem_gravou
             FROM tarefas t LEFT JOIN meetings mt ON mt.id = t.meeting_id
            WHERE t.id = ANY($1::uuid[]) AND t.user_id = $2 AND t.status = ANY($3::text[]) ${fora}`,
          [[...ids], dono, ABERTAS, userId],
        );
        // O que esta reunião já juntou nas ações desta pessoa (reenvio do n8n ou reprocesso).
        const ja = await c.query<{ titulo: string }>(`SELECT titulo_falado AS titulo FROM tarefa_mencoes WHERE meeting_id = $1`, [meetingId]);
        for (const x of ja.rows) jaJuntados.add(normalizarTitulo(x.titulo));
        return r.rows.map(({ com_quem_gravou, ...x }) => ({
          ...x,
          dono_id: dono,
          comQuemGravou: !!com_quem_gravou,
          criada_em: new Date(x.criada_em).toISOString(),
          concluida_em: x.concluida_em ? new Date(x.concluida_em).toISOString() : null,
          reuniao_em: x.reuniao_em ? new Date(x.reuniao_em).toISOString() : null,
        }));
      }),
    ),
  );
  return { candidatas: grupos.flat(), jaJuntados };
}

/** Vetores das candidatas: usa o guardado quando o texto não mudou; calcula o resto. */
async function vetoresDasCandidatas(
  userId: string,
  candidatas: Candidata[],
  aoUsar?: (tokens: number) => void,
): Promise<{ vetores: Map<string, number[]>; novos: { id: string; hash: string; v: number[] }[] }> {
  const vetores = new Map<string, number[]>();
  if (!candidatas.length) return { vetores, novos: [] };
  const hashDe = new Map(candidatas.map((c) => [c.id, hashTexto(textoParaVetor(c))]));
  const guardados = await withTenant(userId, (c) =>
    c.query<{ tarefa_id: string; texto_hash: string; embedding: number[] }>(
      `SELECT tarefa_id, texto_hash, embedding FROM tarefa_embeddings
        WHERE tarefa_id = ANY($1::uuid[]) AND modelo = $2`,
      [candidatas.map((c) => c.id), MODELO_VETOR],
    ),
  );
  for (const g of guardados.rows) {
    if (hashDe.get(g.tarefa_id) === g.texto_hash) vetores.set(g.tarefa_id, g.embedding);
  }
  const faltam = candidatas.filter((c) => !vetores.has(c.id));
  const novos: { id: string; hash: string; v: number[] }[] = [];
  if (faltam.length) {
    const vs = await vetorizar(faltam.map((c) => textoParaVetor(c)), undefined, aoUsar);
    faltam.forEach((c, i) => {
      vetores.set(c.id, vs[i]);
      novos.push({ id: c.id, hash: hashDe.get(c.id)!, v: vs[i] });
    });
  }
  return { vetores, novos };
}

async function guardarVetores(c: PoolClient, userId: string, lista: { id: string; hash: string; v: number[] }[]) {
  for (const x of lista) {
    await c.query(
      `INSERT INTO tarefa_embeddings (tarefa_id, user_id, modelo, texto_hash, embedding, updated_at)
       SELECT $1, $2, $3, $4, $5, now() WHERE EXISTS (SELECT 1 FROM tarefas WHERE id = $1)
       ON CONFLICT (tarefa_id) DO UPDATE
         SET modelo = EXCLUDED.modelo, texto_hash = EXCLUDED.texto_hash,
             embedding = EXCLUDED.embedding, updated_at = now()`,
      [x.id, userId, MODELO_VETOR, x.hash, x.v],
    );
  }
}

async function inserirTarefa(
  c: PoolClient,
  userId: string,
  meetingId: string,
  t: Limpa,
  pareceComId: string | null,
) {
  const r = await c.query<{ id: string; titulo: string; owner: string; prazo: string | null; prioridade: string }>(
    `INSERT INTO tarefas
       (user_id, meeting_id, titulo, descricao, owner, acao, prazo, prazo_text, prioridade,
        evidencia, area_raw, pessoas_raw, precisa_revisao, parece_com_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
     RETURNING id, titulo, owner, prazo, prioridade`,
    [
      userId,
      meetingId,
      t.titulo,
      t.descricao,
      t.owner,
      t.acao,
      t.prazo,
      t.prazo_text,
      t.prioridade,
      t.evidencia,
      t.area_raw,
      t.pessoas_raw,
      t.precisa_revisao,
      pareceComId,
    ],
  );
  return r.rows[0];
}

/** A tarefa já foi mexida por alguém? (aí ela nunca sai sozinha) Na equipe, conta também quem foi marcado nela e a
 *  fala de outra reunião juntada nela (01/10/2026). */
export async function foiMexida(c: PoolClient, tarefaId: string): Promise<boolean> {
  const temAcessos = (await c.query<{ ok: boolean }>(`SELECT to_regclass('tarefa_acessos') IS NOT NULL AS ok`)).rows[0]?.ok;
  const r = await c.query<{ mexida: boolean }>(
    `SELECT (t.no_plano
             OR EXISTS (SELECT 1 FROM quadro_tarefas q WHERE q.tarefa_id = t.id)
             OR EXISTS (SELECT 1 FROM tarefa_eventos e WHERE e.tarefa_id = t.id AND e.evento <> 'criada')
             OR EXISTS (SELECT 1 FROM tarefa_anexos a WHERE a.tarefa_id = t.id)
             OR EXISTS (SELECT 1 FROM coach_commitments cc WHERE cc.tarefa_id = t.id)
             OR EXISTS (SELECT 1 FROM tarefa_mencoes tm WHERE tm.tarefa_id = t.id AND tm.meeting_id IS DISTINCT FROM t.meeting_id)
             ${temAcessos ? "OR EXISTS (SELECT 1 FROM tarefa_acessos ta WHERE ta.tarefa_id = t.id)" : ""}) AS mexida
       FROM tarefas t WHERE t.id = $1`,
    [tarefaId],
  );
  return r.rows[0]?.mexida ?? true;
}

/** "Falada de novo": registra a menção e aplica o prazo novo, se a reunião falou um. */
export async function registrarMencao(
  c: PoolClient,
  p: {
    userId: string;
    alvoId: string;
    meetingId: string | null;
    t: Limpa;
    origem: "reuniao" | "juntada" | "faxina";
    tarefaOrigemId?: string | null;
    /** false: só anota o prazo falado (ação de outra pessoa: o prazo dela não muda pela reunião de outro). */
    mudarPrazo?: boolean;
  },
): Promise<{ inserida: boolean; prazoMudou: boolean }> {
  const alvo = (
    await c.query<{ prazo: string | null; prazo_text: string | null }>(
      `SELECT prazo, prazo_text FROM tarefas WHERE id = $1 FOR UPDATE`,
      [p.alvoId],
    )
  ).rows[0];
  const prazoNovo = p.t.prazo ? new Date(p.t.prazo) : null;
  const prazoAntigo = alvo?.prazo ? new Date(alvo.prazo) : null;
  const muda =
    p.mudarPrazo !== false && !!prazoNovo && !Number.isNaN(prazoNovo.getTime()) && prazoNovo.getTime() !== prazoAntigo?.getTime();

  const ins = await c.query(
    `INSERT INTO tarefa_mencoes
       (user_id, tarefa_id, meeting_id, titulo_falado, descricao_falada, evidencia, owner_falado,
        acao_falada, prazo_falado, prazo_text_falado, prioridade_falada, pessoas_falado, area_falada,
        prazo_anterior, origem, tarefa_origem_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
     ON CONFLICT DO NOTHING`,
    [
      p.userId,
      p.alvoId,
      p.meetingId,
      p.t.titulo,
      p.t.descricao,
      p.t.evidencia,
      p.t.owner,
      p.t.acao,
      p.t.prazo,
      p.t.prazo_text,
      p.t.prioridade,
      p.t.pessoas_raw,
      p.t.area_raw,
      muda ? alvo?.prazo ?? null : null,
      p.origem,
      p.tarefaOrigemId ?? null,
    ],
  );
  const inserida = (ins.rowCount ?? 0) > 0;
  if (inserida && muda) {
    await c.query(`UPDATE tarefas SET prazo = $2, prazo_text = $3 WHERE id = $1`, [
      p.alvoId,
      p.t.prazo,
      p.t.prazo_text,
    ]);
    await c.query(
      `INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1, 'prazo_alterado', $2)`,
      [
        p.alvoId,
        JSON.stringify({ origem: p.origem, meeting_id: p.meetingId, de: alvo?.prazo ?? null, para: p.t.prazo }),
      ],
    );
  }
  return { inserida, prazoMudou: inserida && muda };
}

/** Cancela a cópia e leva o que era dela (menções, quadros, anexos, dúvidas) pro card que fica. */
export async function aposentarCopia(
  c: PoolClient,
  p: { copiaId: string; principalId: string; motivo: "repetida" | "gravacao_fatiada" },
) {
  await c.query(`UPDATE tarefa_mencoes SET tarefa_id = $2 WHERE tarefa_id = $1`, [p.copiaId, p.principalId]);
  await c.query(
    `INSERT INTO quadro_tarefas (quadro_id, tarefa_id, ordem, added_at)
     SELECT quadro_id, $2, ordem, added_at FROM quadro_tarefas WHERE tarefa_id = $1
     ON CONFLICT DO NOTHING`,
    [p.copiaId, p.principalId],
  );
  await c.query(`DELETE FROM quadro_tarefas WHERE tarefa_id = $1`, [p.copiaId]);
  await c.query(`UPDATE tarefa_anexos SET tarefa_id = $2 WHERE tarefa_id = $1`, [p.copiaId, p.principalId]);
  // Equipe: quem via a cópia passa a ver a que fica (quem também fazia continua fazendo).
  if ((await c.query<{ ok: boolean }>(`SELECT to_regclass('tarefa_acessos') IS NOT NULL AS ok`)).rows[0]?.ok) {
    await c.query(
      `INSERT INTO tarefa_acessos (tarefa_id, user_id, created_by, faz)
       SELECT $2, user_id, created_by, faz FROM tarefa_acessos WHERE tarefa_id = $1
       ON CONFLICT DO NOTHING`,
      [p.copiaId, p.principalId],
    );
  }
  await c.query(`UPDATE tarefas SET parece_com_id = $2 WHERE parece_com_id = $1 AND id <> $2`, [
    p.copiaId,
    p.principalId,
  ]);
  await c.query(`UPDATE tarefas SET parece_com_id = NULL WHERE id = $1 AND parece_com_id = $2`, [
    p.principalId,
    p.copiaId,
  ]);
  await c.query(
    `UPDATE tarefas
        SET status = 'cancelada', cancelada_em = now(), situacao_desde = now(), parece_com_id = NULL
      WHERE id = $1`,
    [p.copiaId],
  );
  await c.query(`INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1, 'cancelada', $2)`, [
    p.copiaId,
    JSON.stringify({ motivo: p.motivo, principal_id: p.principalId }),
  ]);
}

export async function incorporarTarefas(p: {
  userId: string;
  meetingId: string;
  tarefas: TarefaExtraida[];
  reprocessar?: boolean;
  juiz?: Juiz;
}): Promise<ResultadoIncorporacao> {
  const tarefas = p.tarefas.filter((t) => t && typeof t.titulo === "string" && t.titulo.trim()).map(limpar);
  const ctx = await withTenant(p.userId, (c) => lerContexto(c, p.userId, p.meetingId, !!p.reprocessar));

  const out: ResultadoIncorporacao = {
    criadas: [],
    juntadas: [],
    substituidas: [],
    ignoradas: 0,
    comparacao: ctx.ligada ? "ligada" : ctx.paiId ? "so_gravacao_fatiada" : "desligada",
  };

  // Equipe: as ações de outras pessoas que esta reunião pode repetir. Reunião de quem gravou em "Só eu" nunca
  // entra: nada dela vai para a ação de outra pessoa.
  const equipe = isTeamMode();
  if (equipe && ctx.ligada && !ctx.soEu && tarefas.length && ctx.reuniaoEm && ctx.reuniaoFim) {
    try {
      const ja = new Set(ctx.candidatas.map((x) => x.id));
      const r = await candidatasDaEquipe(p.userId, p.meetingId, new Date(ctx.reuniaoEm), new Date(ctx.reuniaoFim));
      ctx.candidatas.push(...r.candidatas.filter((x) => !ja.has(x.id)));
      for (const t of r.jaJuntados) ctx.titulosJaNaReuniao.add(t);
    } catch (e) {
      // Sem as das outras pessoas, a comparação segue com as de quem gravou.
      console.error("[tarefas-repetidas] ações da equipe não vieram:", e instanceof Error ? e.message : e);
    }
  }

  // Reenvio da mesma reunião (o n8n tentou de novo) ou tarefa que sobreviveu ao
  // reprocessamento (feita, ou criada à mão): o que já existe aqui não nasce de novo.
  const novas = tarefas.filter((t) => {
    if (ctx.titulosJaNaReuniao.has(normalizarTitulo(t.titulo))) {
      out.ignoradas++;
      return false;
    }
    return true;
  });

  let decisoes: Decisao[] = novas.map(() => ({ tipo: "nova", votos: 0 }));
  let vetoresNovas: number[][] = [];
  let vetoresNovos: { id: string; hash: string; v: number[] }[] = [];
  if (novas.length && ctx.candidatas.length) {
    try {
      let tokensVetor = 0;
      const somar = (n: number) => {
        tokensVetor += n;
      };
      vetoresNovas = await vetorizar(
        novas.map((t) => textoParaVetor(t)),
        undefined,
        somar,
      );
      const cand = await vetoresDasCandidatas(p.userId, ctx.candidatas, somar);
      // Só o vetor das ações de quem gravou fica guardado (a linha guardada é do dono da ação).
      const minhas = new Set(ctx.candidatas.filter((x) => x.dono_id === p.userId).map((x) => x.id));
      vetoresNovos = cand.novos.filter((x) => minhas.has(x.id));
      const juiz = equipe ? await comNomes(p.userId, novas, ctx.candidatas) : { novas, candidatas: ctx.candidatas };
      const r = await compararComExistentes({
        dataReuniao: ctx.reuniaoEm,
        novas: juiz.novas,
        vetoresNovas,
        candidatas: juiz.candidatas,
        vetoresCandidatas: cand.vetores,
        exemplos: ctx.exemplos,
        juiz: p.juiz,
      });
      if (equipe) await registrarGasto(p.userId, p.meetingId, r.uso, tokensVetor);
      decisoes = r.decisoes;
      if (r.uso.falhas === r.uso.chamadas && r.uso.chamadas > 0) {
        out.comparacao = "falhou";
        out.aviso = "a IA de comparação não respondeu; as tarefas nasceram sem comparar";
      }
    } catch (e) {
      console.error("[tarefas-repetidas] comparação falhou:", e instanceof Error ? e.message : e);
      decisoes = novas.map(() => ({ tipo: "nova", votos: 0 }));
      out.comparacao = "falhou";
      out.aviso = "a comparação falhou; as tarefas nasceram sem comparar";
    }
  }

  const candPorId = new Map(ctx.candidatas.map((x) => [x.id, x]));
  // Ação de outra pessoa (equipe): a mesma vira "falada de novo" lá ANTES de gravar as desta reunião (se cair no
  // meio, o reenvio refaz sem perder nada). Nasce normal: a dúvida com ação de outra pessoa, e a ação que quem
  // gravou disse que ELE faz (nunca some da lista de quem vai fazer), a não ser que ela já seja com ele (passada a
  // ele ou ele também faz): aí ela já está na lista dele.
  const juntadasFora = new Set<number>();
  for (let i = 0; i < novas.length; i++) {
    const d = decisoes[i];
    const alvo = d.tipo !== "nova" ? candPorId.get(d.tarefaId) : undefined;
    if (!alvo || alvo.dono_id === p.userId) continue;
    if (d.tipo === "mesma" && (!isOwner(novas[i].owner) || alvo.comQuemGravou)) {
      let juntou = false;
      try {
        juntou = await juntarNaDeOutro(p.userId, p.meetingId, novas[i], alvo);
      } catch (e) {
        console.error("[tarefas-repetidas] juntar na ação de outra pessoa falhou:", e instanceof Error ? e.message : e);
      }
      if (juntou) {
        juntadasFora.add(i);
        out.juntadas.push({ tarefa_id: alvo.id, titulo_existente: alvo.titulo, titulo_falado: novas[i].titulo, prazo_mudou: false });
        continue;
      }
    }
    decisoes[i] = { tipo: "nova", votos: 0 };
  }

  await withTenant(p.userId, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('tarefas-repetidas:' || $1))`, [p.userId]);
    if (p.reprocessar) {
      await c.query(`DELETE FROM tarefa_mencoes WHERE meeting_id = $1 AND origem = 'reuniao'`, [p.meetingId]);
    }
    // Outra reunião pode ter gravado enquanto esta era comparada: título idêntico
    // já na lista vira "falada de novo" em vez de card repetido.
    const recentes = await c.query<{ id: string; titulo: string }>(
      `SELECT id, titulo FROM tarefas
        WHERE user_id = $1 AND meeting_id IS DISTINCT FROM $2
          AND status = ANY($3::text[]) AND created_at > now() - interval '15 minutes'`,
      [p.userId, p.meetingId, ABERTAS],
    );
    const recentePorTitulo = new Map(recentes.rows.map((r) => [normalizarTitulo(r.titulo), r.id]));
    // Pedido ao marketing: o prazo e a situação são do marketing; a reunião nunca junta nele (vira "parece com").
    const temPedidos = (await c.query<{ ok: boolean }>(`SELECT to_regclass('tarefa_pedidos') IS NOT NULL AS ok`)).rows[0]?.ok;
    const ehPedido = async (id: string) =>
      !!temPedidos && ((await c.query(`SELECT 1 FROM tarefa_pedidos WHERE tarefa_id = $1`, [id])).rowCount ?? 0) > 0;

    const guardar: { id: string; hash: string; v: number[] }[] = [...vetoresNovos];
    for (let i = 0; i < novas.length; i++) {
      if (juntadasFora.has(i)) continue;
      const t = novas[i];
      let d = decisoes[i];
      if (d.tipo === "nova" && ctx.ligada) {
        const igual = recentePorTitulo.get(normalizarTitulo(t.titulo));
        if (igual) d = { tipo: "mesma", tarefaId: igual, votos: 0 };
      }

      if (d.tipo === "mesma") {
        const alvo = candPorId.get(d.tarefaId);
        // o alvo ainda está aberto? (pode ter sido concluído/apagado nesse meio tempo)
        const agora = (
          await c.query<{ status: string; meeting_id: string | null }>(
            `SELECT status, meeting_id FROM tarefas WHERE id = $1`,
            [d.tarefaId],
          )
        ).rows[0];
        if (!agora || !ABERTAS.includes(agora.status) || (await ehPedido(d.tarefaId))) {
          d = agora ? { tipo: "duvida", tarefaId: d.tarefaId, votos: d.votos } : { tipo: "nova", votos: 0 };
        } else if (agora.meeting_id === p.meetingId) {
          // reprocessando: já existe nesta mesma reunião (feita à mão ou mantida)
          out.ignoradas++;
          continue;
        } else if (ctx.paiId && agora.meeting_id === ctx.paiId && !(await foiMexida(c, d.tarefaId))) {
          // parte de gravação fatiada: a tarefa da parte substitui a da gravação inteira
          const nova = await inserirTarefa(c, p.userId, p.meetingId, t, null);
          await aposentarCopia(c, { copiaId: d.tarefaId, principalId: nova.id, motivo: "gravacao_fatiada" });
          out.criadas.push({ ...nova, parece_com_id: null });
          out.substituidas.push({ antiga_id: d.tarefaId, nova_id: nova.id, titulo: nova.titulo });
          if (vetoresNovas[i]) guardar.push({ id: nova.id, hash: hashTexto(textoParaVetor(t)), v: vetoresNovas[i] });
          continue;
        } else {
          const m = await registrarMencao(c, {
            userId: p.userId,
            alvoId: d.tarefaId,
            meetingId: p.meetingId,
            t,
            origem: "reuniao",
          });
          out.juntadas.push({
            tarefa_id: d.tarefaId,
            titulo_existente: alvo?.titulo ?? "",
            titulo_falado: t.titulo,
            prazo_mudou: m.prazoMudou,
          });
          continue;
        }
      }

      const pareceCom = d.tipo === "duvida" ? d.tarefaId : null;
      const nova = await inserirTarefa(c, p.userId, p.meetingId, t, pareceCom);
      out.criadas.push({ ...nova, parece_com_id: pareceCom });
      if (vetoresNovas[i]) guardar.push({ id: nova.id, hash: hashTexto(textoParaVetor(t)), v: vetoresNovas[i] });
    }
    await guardarVetores(c, p.userId, guardar);
  });

  return out;
}

/**
 * A fala que repete a ação de outra pessoa (equipe): vira "falada de novo" na ação dela, no tenant dela, sem mudar o
 * prazo, e quem gravou passa a ver a ação (fica registrado no histórico dela). Revisão de 01/10/2026:
 *   - vai só o que foi pedido (título, dono e prazo falados): o trecho, o detalhe e as pessoas da reunião de quem
 *     gravou não saem dela (mesma regra de SEM_REUNIAO para colega);
 *   - o dono falado é escrito do ponto de vista da dona da ação ("eu" = ela; outra pessoa = cobrar);
 *   - reenvio e reprocesso não juntam de novo: uma menção por reunião em cada ação.
 * false = a ação já não está aberta (ou é pedido ao marketing): quem chama cria a ação normal.
 */
async function juntarNaDeOutro(gravouId: string, meetingId: string, t: Limpa, alvo: Cand): Promise<boolean> {
  return withTenant(alvo.dono_id, async (c) => {
    const agora = (
      await c.query<{ status: string; responsavel: string | null }>(
        `SELECT status, responsavel_user_id::text AS responsavel FROM tarefas WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [alvo.id, alvo.dono_id],
      )
    ).rows[0];
    if (!agora || !ABERTAS.includes(agora.status)) return false;
    // Pedido ao marketing: o prazo e a situação são do marketing; a reunião nunca junta nele.
    const temPedidos = (await c.query<{ ok: boolean }>(`SELECT to_regclass('tarefa_pedidos') IS NOT NULL AS ok`)).rows[0]?.ok;
    if (temPedidos && ((await c.query(`SELECT 1 FROM tarefa_pedidos WHERE tarefa_id = $1`, [alvo.id])).rowCount ?? 0) > 0) return false;
    const jaTem = await c.query(`SELECT 1 FROM tarefa_mencoes WHERE tarefa_id = $1 AND meeting_id = $2 LIMIT 1`, [alvo.id, meetingId]);
    if ((jaTem.rowCount ?? 0) > 0) return true;

    const pessoas = (
      await c.query<{ id: string; nome: string }>(`SELECT id::text AS id, nome FROM users WHERE deleted_at IS NULL AND COALESCE(nome, '') <> ''`)
    ).rows;
    // O "eu" de quem gravou é ele, nunca a dona da ação; outro nome só é o da dona se for dela e de mais ninguém
    // (Ana Tereza dizendo "eu" numa ação da Ana Carolina não vira "eu" da Ana Carolina).
    const deQuemGravou = isOwner(t.owner);
    const quem = deQuemGravou ? (pessoas.find((x) => x.id === gravouId)?.nome ?? t.owner) : t.owner;
    const daDona = !deQuemGravou && !!quem && pessoaDoNome(quem, pessoas) === alvo.dono_id;
    const fala: Limpa = {
      ...t,
      owner: daDona ? getOwnerSlug() : quem,
      acao: daDona ? "executar" : "cobrar",
      descricao: null,
      evidencia: null,
      pessoas_raw: null,
      area_raw: null,
    };
    await registrarMencao(c, { userId: alvo.dono_id, alvoId: alvo.id, meetingId, t: fala, origem: "reuniao", mudarPrazo: false });
    if (agora.responsavel !== gravouId) {
      const novo = await c.query(
        `INSERT INTO tarefa_acessos (tarefa_id, user_id, created_by) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`,
        [alvo.id, gravouId],
      );
      if ((novo.rowCount ?? 0) > 0) {
        await c.query(`INSERT INTO tarefa_eventos (tarefa_id, evento, payload, ator_user_id) VALUES ($1, 'editada', $2, $3)`, [
          alvo.id,
          JSON.stringify({ changed: { quem_ve: { juntou: gravouId } }, origem: "repetida", meeting_id: meetingId }),
          gravouId,
        ]);
      }
    }
    return true;
  });
}

/**
 * Para o juiz, "eu" vira o nome de quem é: na equipe a candidata pode ser de outra pessoa, e "Dono: eu" nas duas
 * pontas confundiria quem faz. Só o que vai ao juiz muda; nada disso é gravado.
 */
async function comNomes(gravouId: string, novas: Limpa[], candidatas: Cand[]) {
  const ids = [...new Set([gravouId, ...candidatas.map((x) => x.dono_id)])];
  const nomes = new Map(
    (await query<{ id: string; nome: string }>(`SELECT id::text AS id, nome FROM users WHERE id = ANY($1::uuid[])`, [ids])).map(
      (x) => [x.id, x.nome] as const,
    ),
  );
  const nome = (owner: string | null, de: string) => (owner && isOwner(owner) ? (nomes.get(de) ?? owner) : owner);
  return {
    novas: novas.map((t) => ({ ...t, owner: nome(t.owner, gravouId) })),
    candidatas: candidatas.map((x) => ({ ...x, owner: nome(x.owner, x.dono_id) })),
  };
}

/** O gasto da comparação no registro de gastos com IA (aba Gastos): o juiz e os vetores, por reunião. */
/** Dono de uma reunião, procurado conta por conta (cada uma só vê as dela): primeiro em `provaveis`. */
async function donoDaReuniao(meetingId: string, provaveis: string[]): Promise<string | null> {
  const contas = (await query<{ id: string }>(`SELECT id::text AS id FROM users WHERE deleted_at IS NULL`)).map((x) => x.id);
  for (const id of [...new Set([...provaveis, ...contas])]) {
    const r = await withTenant(id, (c) => c.query(`SELECT 1 FROM meetings WHERE id = $1 AND user_id = $2`, [meetingId, id]));
    if ((r.rowCount ?? 0) > 0) return id;
  }
  return null;
}

/**
 * "Não é a mesma: virar ação separada" numa fala que a trava juntou vinda da reunião de OUTRA pessoa (revisão de
 * 01/10/2026): a ação volta para a lista de quem gravou, como ação da reunião dele, e o juiz dos dois aprende que
 * são diferentes; quem gravou deixa de ver a ação da dona (se só via por causa dessa fala). null = a fala não é de
 * reunião de outra pessoa (segue o caminho de sempre).
 */
export async function devolverFalaDeOutro(
  donaId: string,
  mencaoId: string,
): Promise<{ tarefa_id: string; gravou_id: string; gravou_nome: string | null } | null> {
  const lido = await withTenant(donaId, async (c) => {
    const m = (
      await c.query<{
        tarefa_id: string;
        meeting_id: string | null;
        tarefa_origem_id: string | null;
        da_dona: boolean;
        titulo_falado: string;
        owner_falado: string | null;
        prazo_falado: string | null;
        prazo_text_falado: string | null;
        prioridade_falada: string | null;
      }>(
        `SELECT tarefa_id::text AS tarefa_id, meeting_id::text AS meeting_id, tarefa_origem_id::text AS tarefa_origem_id,
                EXISTS (SELECT 1 FROM meetings WHERE id = tarefa_mencoes.meeting_id AND user_id = $2) AS da_dona,
                titulo_falado, owner_falado, prazo_falado, prazo_text_falado, prioridade_falada
           FROM tarefa_mencoes WHERE id = $1`,
        [mencaoId, donaId],
      )
    ).rows[0];
    if (!m || !m.meeting_id || m.da_dona || m.tarefa_origem_id) return null;
    const card = (await c.query<{ titulo: string; descricao: string | null }>(`SELECT titulo, descricao FROM tarefas WHERE id = $1`, [m.tarefa_id])).rows[0];
    if (!card) return null;
    const provaveis = (
      await c.query<{ id: string }>(`SELECT user_id::text AS id FROM tarefa_acessos WHERE tarefa_id = $1 AND created_by = user_id`, [m.tarefa_id])
    ).rows.map((x) => x.id);
    const outras = (
      await c.query<{ id: string }>(
        `SELECT DISTINCT meeting_id::text AS id FROM tarefa_mencoes WHERE tarefa_id = $1 AND id <> $2 AND meeting_id IS NOT NULL`,
        [m.tarefa_id, mencaoId],
      )
    ).rows.map((x) => x.id);
    return { m: { ...m, meeting_id: m.meeting_id }, card, provaveis, outras };
  });
  if (!lido) return null;
  const { m, card, provaveis, outras } = lido;
  const gravouId = await donoDaReuniao(m.meeting_id, provaveis);
  if (!gravouId) return null;

  const pessoas = await query<{ id: string; nome: string }>(`SELECT id::text AS id, nome FROM users WHERE deleted_at IS NULL AND COALESCE(nome, '') <> ''`);
  const nomeDe = (id: string) => pessoas.find((x) => x.id === id)?.nome ?? null;
  // A fala está escrita do ponto de vista da dona ("eu" = ela): volta para o de quem gravou.
  const dito = (m.owner_falado ?? "").trim();
  const daDona = !dito || isOwner(dito);
  const dele = !daDona && pessoaDoNome(dito, pessoas) === gravouId;
  const owner = dele ? getOwnerSlug() : daDona ? (nomeDe(donaId) ?? dito) : dito;
  const prioridade = PRIORIDADES.includes(String(m.prioridade_falada)) ? String(m.prioridade_falada) : "media";

  // Primeiro a ação de quem gravou, depois a fala sai da ação da dona: se cair no meio, sobra uma a mais, nunca some.
  const { tarefaId, aindaDele } = await withTenant(gravouId, async (c) => {
    const aindaDele =
      outras.length > 0 &&
      ((await c.query(`SELECT 1 FROM meetings WHERE id = ANY($1::uuid[]) AND user_id = $2 LIMIT 1`, [outras, gravouId])).rowCount ?? 0) > 0;
    const r = await c.query<{ id: string }>(
      `INSERT INTO tarefas (user_id, meeting_id, titulo, owner, acao, prazo, prazo_text, prioridade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text AS id`,
      [gravouId, m.meeting_id, m.titulo_falado, owner, dele ? "executar" : "cobrar", m.prazo_falado, m.prazo_text_falado, prioridade],
    );
    await c.query(`INSERT INTO extracao_feedback (user_id, meeting_id, tipo, payload) VALUES ($1,$2,'diferente',$3)`, [
      gravouId,
      m.meeting_id,
      JSON.stringify({ nova: { titulo: m.titulo_falado, descricao: null }, existente: { titulo: card.titulo, descricao: null } }),
    ]);
    return { tarefaId: r.rows[0].id, aindaDele };
  });

  await withTenant(donaId, async (c) => {
    await c.query(`DELETE FROM tarefa_mencoes WHERE id = $1`, [mencaoId]);
    await c.query(`INSERT INTO extracao_feedback (user_id, meeting_id, tipo, payload) VALUES ($1,$2,'diferente',$3)`, [
      donaId,
      m.meeting_id,
      JSON.stringify({ nova: { titulo: m.titulo_falado, descricao: null }, existente: { titulo: card.titulo, descricao: card.descricao } }),
    ]);
    if (aindaDele) return;
    const saiu = await c.query(
      `DELETE FROM tarefa_acessos WHERE tarefa_id = $1 AND user_id = $2 AND created_by = $2 AND NOT faz`,
      [m.tarefa_id, gravouId],
    );
    if ((saiu.rowCount ?? 0) > 0) {
      await c.query(`INSERT INTO tarefa_eventos (tarefa_id, evento, payload, ator_user_id) VALUES ($1, 'editada', $2, $3)`, [
        m.tarefa_id,
        JSON.stringify({ changed: { quem_ve: { saiu: gravouId } }, origem: "repetida_separada", meeting_id: m.meeting_id }),
        donaId,
      ]);
    }
  });
  return { tarefa_id: tarefaId, gravou_id: gravouId, gravou_nome: nomeDe(gravouId) };
}

async function registrarGasto(
  userId: string,
  meetingId: string,
  uso: { entrada: number; saida: number; chamadas: number },
  tokensVetor: number,
) {
  const modelo = modeloDoJuiz();
  if (uso.chamadas > 0) {
    const tokens = { inputTokens: uso.entrada, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: uso.saida };
    await recordAiUsage({
      ref: `tarefas_repetidas:${meetingId}:${randomUUID()}`,
      agent: "tarefas_repetidas",
      provider: "openai",
      model: modelo,
      source: "app",
      userId,
      meetingId,
      ...tokens,
      costUsd: requestCostUsd(modelo, tokens),
      basis: "medido",
      note: `${uso.chamadas} leituras do juiz`,
    });
  }
  if (tokensVetor > 0) {
    const tokens = { inputTokens: tokensVetor, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    await recordAiUsage({
      ref: `tarefas_repetidas_vetor:${meetingId}:${randomUUID()}`,
      agent: "tarefas_repetidas",
      provider: "openai",
      model: MODELO_VETOR,
      source: "app",
      userId,
      meetingId,
      ...tokens,
      costUsd: requestCostUsd(MODELO_VETOR, tokens),
      basis: "medido",
      note: "vetores das tarefas",
    });
  }
}

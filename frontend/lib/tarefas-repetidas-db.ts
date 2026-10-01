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

/** Candidata com o dono da linha (quem criou): na equipe pode ser outra pessoa. */
type Cand = Candidata & { meeting_id: string | null; dono_id: string };

type Contexto = {
  reuniaoEm: string | null;
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
    await c.query<{ reuniao_em: string | null; duracao: number | null; parent_meeting_id: string | null }>(
      `SELECT COALESCE(recorded_at, created_at) AS reuniao_em, duration_seconds AS duracao, parent_meeting_id
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
                reprocessar
                ? "TRUE"
                : "t.meeting_id IS DISTINCT FROM $5"
              : // desligada: só a gravação inteira de quem é parte (fatiada)
                "t.meeting_id = $5 AND t.status = ANY($2::text[])"
          }`,
      ligada && reprocessar
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
    reuniaoFim: inicio ? new Date(inicio.getTime() + Math.max(0, Number(m.duracao) || 0) * 1000).toISOString() : null,
    paiId: m.parent_meeting_id,
    ligada,
    titulosJaNaReuniao,
    candidatas,
    exemplos,
  };
}

/** Folga em volta do horário da reunião ao procurar outra gravação dela (o Teams e o celular não começam juntos). */
const FOLGA_MESMA_REUNIAO_MS = 15 * 60_000;

type Par = { tarefa_id: string; dono_id: string };

/**
 * Equipe: ações de OUTRAS pessoas que a reunião nova pode estar repetindo.
 *   - as que passaram ou marcaram para quem gravou (ela já tem a ação na lista);
 *   - as de outra gravação da MESMA reunião: alguém gravou no mesmo horário (no Teams, no celular, no Mac) e
 *     quem gravou ESTAVA na dela, ou ela ESTAVA nesta. Ex.: 29/09, "Weddings" no Teams da Diana e "Plano
 *     Weddings" no celular do Tiago, a mesma reunião.
 * "Estava" é a mesma regra de puxar ação (equipe_chamado_na_reuniao): convite, voz ou marcado como "estava";
 * quem só foi marcado para ver não conta, e reunião fechada em "Só eu" nunca entra. Só ações abertas, sem
 * pedido ao marketing e sem Notion (o prazo e a situação dessas são do marketing).
 */
export async function candidatasDaEquipe(
  userId: string,
  meetingId: string,
  inicio: Date,
  fim: Date,
): Promise<Cand[]> {
  const de = new Date(inicio.getTime() - FOLGA_MESMA_REUNIAO_MS);
  const ate = new Date(fim.getTime() + FOLGA_MESMA_REUNIAO_MS);
  const mesmoHorario = `COALESCE(m.recorded_at, m.created_at) < $3
       AND COALESCE(m.recorded_at, m.created_at) + make_interval(secs => COALESCE(m.duration_seconds, 0)) > $2`;
  const { pares, presentes } = await withTenantLeituraEquipe(userId, async (c) => {
    const minhas = await c.query<Par>(
      `SELECT tarefa_id::text AS tarefa_id, dono_id::text AS dono_id FROM equipe_tarefas_para_mim()
       UNION
       SELECT tarefa_id::text, dono_id::text FROM equipe_tarefas_marcadas_para_mim()`,
    );
    // Reuniões de outras pessoas, no mesmo horário desta, em que quem gravou estava.
    const mesmas = await c.query<Par>(
      `SELECT t.id::text AS tarefa_id, t.user_id::text AS dono_id
         FROM meetings m JOIN tarefas t ON t.meeting_id = m.id
        WHERE m.user_id <> $1 AND ${mesmoHorario} AND equipe_chamado_na_reuniao(m.id)`,
      [userId, de, ate],
    );
    // Quem estava nesta reunião (convite, voz ou "estava"; não quem só foi marcado para ver).
    const p = await c.query<{ id: string }>(
      `SELECT DISTINCT user_id::text AS id FROM meeting_acessos
        WHERE meeting_id = $1 AND user_id IS NOT NULL AND user_id <> $2 AND motivo <> 'quem_ve'`,
      [meetingId, userId],
    );
    return { pares: [...minhas.rows, ...mesmas.rows], presentes: p.rows.map((x) => x.id) };
  });
  // Quem estava nesta reunião e gravou a mesma no mesmo horário (quem gravou esta pode não estar marcado na dela).
  // Gravação que a pessoa fechou em "Só eu" fica de fora.
  for (const pessoa of presentes) {
    const r = await withTenant(pessoa, (c) =>
      c.query<Par>(
        `SELECT t.id::text AS tarefa_id, t.user_id::text AS dono_id
           FROM meetings m JOIN tarefas t ON t.meeting_id = m.id
          WHERE m.user_id = $1 AND m.visibilidade <> 'so_eu' AND ${mesmoHorario}`,
        [pessoa, de, ate],
      ),
    );
    pares.push(...r.rows);
  }

  const porDono = new Map<string, Set<string>>();
  for (const x of pares) {
    if (x.dono_id === userId) continue; // as de quem gravou já entraram pelo caminho de sempre
    if (!porDono.has(x.dono_id)) porDono.set(x.dono_id, new Set());
    porDono.get(x.dono_id)!.add(x.tarefa_id);
  }
  if (!porDono.size) return [];
  const t = await query<{ pedidos: boolean; notion: boolean }>(
    `SELECT to_regclass('tarefa_pedidos') IS NOT NULL AS pedidos, to_regclass('notion_paginas') IS NOT NULL AS notion`,
  );
  const fora = [
    t[0]?.pedidos ? "AND NOT EXISTS (SELECT 1 FROM tarefa_pedidos tp WHERE tp.tarefa_id = t.id)" : "",
    t[0]?.notion ? "AND NOT EXISTS (SELECT 1 FROM notion_paginas np WHERE np.tarefa_id = t.id)" : "",
  ].join(" ");
  const grupos = await Promise.all(
    [...porDono.entries()].map(([dono, ids]) =>
      withTenant(dono, (c) =>
        c.query<{
          id: string;
          titulo: string;
          descricao: string | null;
          owner: string | null;
          status: string;
          meeting_id: string | null;
          criada_em: string;
          concluida_em: string | null;
          reuniao_em: string | null;
        }>(
          `SELECT t.id::text AS id, t.titulo, t.descricao, t.owner, t.status, t.meeting_id::text AS meeting_id,
                  t.created_at AS criada_em, t.concluida_em, COALESCE(mt.recorded_at, mt.created_at) AS reuniao_em
             FROM tarefas t LEFT JOIN meetings mt ON mt.id = t.meeting_id
            WHERE t.id = ANY($1::uuid[]) AND t.user_id = $2 AND t.status = ANY($3::text[]) ${fora}`,
          [[...ids], dono, ABERTAS],
        ),
      ).then((r) =>
        r.rows.map((x) => ({
          ...x,
          dono_id: dono,
          criada_em: new Date(x.criada_em).toISOString(),
          concluida_em: x.concluida_em ? new Date(x.concluida_em).toISOString() : null,
          reuniao_em: x.reuniao_em ? new Date(x.reuniao_em).toISOString() : null,
        })),
      ),
    ),
  );
  return grupos.flat();
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

/** A tarefa já foi mexida por alguém? (aí ela nunca sai sozinha) */
export async function foiMexida(c: PoolClient, tarefaId: string): Promise<boolean> {
  const r = await c.query<{ mexida: boolean }>(
    `SELECT (t.no_plano
             OR EXISTS (SELECT 1 FROM quadro_tarefas q WHERE q.tarefa_id = t.id)
             OR EXISTS (SELECT 1 FROM tarefa_eventos e WHERE e.tarefa_id = t.id AND e.evento <> 'criada')
             OR EXISTS (SELECT 1 FROM tarefa_anexos a WHERE a.tarefa_id = t.id)
             OR EXISTS (SELECT 1 FROM coach_commitments cc WHERE cc.tarefa_id = t.id)) AS mexida
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

  // Reenvio da mesma reunião (o n8n tentou de novo) ou tarefa que sobreviveu ao
  // reprocessamento (feita, ou criada à mão): o que já existe aqui não nasce de novo.
  const novas = tarefas.filter((t) => {
    if (ctx.titulosJaNaReuniao.has(normalizarTitulo(t.titulo))) {
      out.ignoradas++;
      return false;
    }
    return true;
  });

  const equipe = isTeamMode();
  if (equipe && ctx.ligada && novas.length && ctx.reuniaoEm && ctx.reuniaoFim) {
    try {
      const ja = new Set(ctx.candidatas.map((x) => x.id));
      const outras = await candidatasDaEquipe(p.userId, p.meetingId, new Date(ctx.reuniaoEm), new Date(ctx.reuniaoFim));
      ctx.candidatas.push(...outras.filter((x) => !ja.has(x.id)));
    } catch (e) {
      // Sem as das outras pessoas, a comparação segue com as de quem gravou.
      console.error("[tarefas-repetidas] ações da equipe não vieram:", e instanceof Error ? e.message : e);
    }
  }

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
  const deOutros: { t: Limpa; alvo: Cand; vetor?: number[] }[] = [];
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
      const t = novas[i];
      let d = decisoes[i];
      const alvoDeOutro = d.tipo !== "nova" ? candPorId.get(d.tarefaId) : undefined;
      if (alvoDeOutro && alvoDeOutro.dono_id !== p.userId) {
        // Ação de outra pessoa: a mesma vira "falada de novo" lá (depois desta gravação); a dúvida nasce normal.
        if (d.tipo === "mesma") {
          deOutros.push({ t, alvo: alvoDeOutro, vetor: vetoresNovas[i] });
          continue;
        }
        d = { tipo: "nova", votos: 0 };
      }
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

  for (const x of deOutros) {
    let juntou = false;
    try {
      juntou = await juntarNaDeOutro(p.userId, p.meetingId, x.t, x.alvo);
    } catch (e) {
      console.error("[tarefas-repetidas] juntar na ação de outra pessoa falhou:", e instanceof Error ? e.message : e);
    }
    if (juntou) {
      out.juntadas.push({ tarefa_id: x.alvo.id, titulo_existente: x.alvo.titulo, titulo_falado: x.t.titulo, prazo_mudou: false });
      continue;
    }
    // A ação da outra pessoa fechou nesse meio tempo (ou deu erro): a tarefa nasce aqui, como sempre.
    const nova = await withTenant(p.userId, async (c) => {
      const n = await inserirTarefa(c, p.userId, p.meetingId, x.t, null);
      if (x.vetor) await guardarVetores(c, p.userId, [{ id: n.id, hash: hashTexto(textoParaVetor(x.t)), v: x.vetor }]);
      return n;
    });
    out.criadas.push({ ...nova, parece_com_id: null });
  }
  return out;
}

/**
 * A fala que repete a ação de outra pessoa: vira "falada de novo" na ação dela (no tenant dela, sem mudar o
 * prazo) e quem gravou passa a ver a ação (marcado nela), para não perder o que foi dito na reunião dele.
 * false = a ação já não está aberta (ou é pedido ao marketing): quem chama cria a tarefa normal.
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
    await registrarMencao(c, {
      userId: alvo.dono_id,
      alvoId: alvo.id,
      meetingId,
      t,
      origem: "reuniao",
      mudarPrazo: false,
    });
    if (agora.responsavel !== gravouId) {
      await c.query(
        `INSERT INTO tarefa_acessos (tarefa_id, user_id, created_by) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`,
        [alvo.id, gravouId],
      );
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

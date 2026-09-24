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
import type { PoolClient } from "pg";
import { withTenant } from "./db";
import {
  compararComExistentes,
  vetorizar,
  textoParaVetor,
  hashTexto,
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

type Contexto = {
  reuniaoEm: string | null;
  paiId: string | null;
  ligada: boolean;
  titulosJaNaReuniao: Set<string>;
  candidatas: (Candidata & { meeting_id: string | null })[];
  exemplos: Exemplo[];
};

async function lerContexto(
  c: PoolClient,
  userId: string,
  meetingId: string,
  reprocessar: boolean,
): Promise<Contexto> {
  const m = (
    await c.query<{ reuniao_em: string | null; parent_meeting_id: string | null }>(
      `SELECT COALESCE(recorded_at, created_at) AS reuniao_em, parent_meeting_id
         FROM meetings WHERE id = $1`,
      [meetingId],
    )
  ).rows[0];
  if (!m) throw new Error("reunião não encontrada");
  const u = (
    await c.query<{ desde: string | null }>(`SELECT dedup_tarefas_desde AS desde FROM users WHERE id = $1`, [userId])
  ).rows[0];
  const ligada = !!u?.desde;

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

  return {
    reuniaoEm: m.reuniao_em ? new Date(m.reuniao_em).toISOString() : null,
    paiId: m.parent_meeting_id,
    ligada,
    titulosJaNaReuniao,
    candidatas,
    exemplos,
  };
}

/** Vetores das candidatas: usa o guardado quando o texto não mudou; calcula o resto. */
async function vetoresDasCandidatas(
  userId: string,
  candidatas: Candidata[],
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
    const vs = await vetorizar(faltam.map((c) => textoParaVetor(c)));
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
  const muda = !!prazoNovo && !Number.isNaN(prazoNovo.getTime()) && prazoNovo.getTime() !== prazoAntigo?.getTime();

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

  let decisoes: Decisao[] = novas.map(() => ({ tipo: "nova", votos: 0 }));
  let vetoresNovas: number[][] = [];
  let vetoresNovos: { id: string; hash: string; v: number[] }[] = [];
  if (novas.length && ctx.candidatas.length) {
    try {
      vetoresNovas = await vetorizar(novas.map((t) => textoParaVetor(t)));
      const cand = await vetoresDasCandidatas(p.userId, ctx.candidatas);
      vetoresNovos = cand.novos;
      const r = await compararComExistentes({
        dataReuniao: ctx.reuniaoEm,
        novas,
        vetoresNovas,
        candidatas: ctx.candidatas,
        vetoresCandidatas: cand.vetores,
        exemplos: ctx.exemplos,
        juiz: p.juiz,
      });
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

    const guardar: { id: string; hash: string; v: number[] }[] = [...vetoresNovos];
    for (let i = 0; i < novas.length; i++) {
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
        if (!agora || !ABERTAS.includes(agora.status)) {
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

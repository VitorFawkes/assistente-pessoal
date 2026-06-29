import { withTenant } from "./db";

// ─── Tipos (espelham o schema atual) ──────────────────────────────────

export type Meeting = {
  id: string;
  user_id: string;
  source: "macbook" | "iphone" | "ios-app" | "segmented";
  meeting_type: "online" | "presencial" | "desconhecido" | null;
  original_filename: string;
  audio_path: string;
  audio_size_bytes: number | null;
  duration_seconds: number | null;
  recorded_at: string | null;
  status:
    | "received"
    | "transcribing"
    | "analyzing"
    | "done"
    | "error"
    | "archived_session";
  status_error: string | null;
  transcription: string | null;
  summary: string | null;
  raw_ai_response: unknown;
  segments: unknown;
  speaker_labels: Record<string, string> | null;
  speaker_pessoas: Record<string, string> | null;
  speaker_labels_proposed: Record<string, unknown> | null;
  parent_meeting_id: string | null;
  segment_index: number | null;
  segment_start_offset: number | null;
  segment_end_offset: number | null;
  needs_segmentation: boolean;
  created_at: string;
  done_at: string | null;
};

export type Acao = "executar" | "cobrar" | "aguardar";

export type TarefaPessoa = { id: string; nome: string; principal: boolean };

export type Tarefa = {
  id: string;
  user_id: string;
  meeting_id: string | null;
  titulo: string;
  descricao: string | null;
  owner: string;
  is_mine: boolean;
  acao: Acao;
  prazo: string | null;
  inicio: string | null;
  prazo_text: string | null;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  status: "aberta" | "em_andamento" | "concluida" | "cancelada";
  evidencia: string | null;
  frente: string | null;
  frente_proposta: string | null;
  frentes: { id: string; nome: string; principal: boolean }[];
  pessoas: TarefaPessoa[];
  created_at: string;
  updated_at: string;
  concluida_em: string | null;
  cancelada_em: string | null;
  precisa_revisao: boolean;
  ordem: number | null;
  no_plano: boolean;
  // Campos opcionais que podem vir do JOIN com meetings
  meeting_summary?: string | null;
  meeting_recorded_at?: string | null;
  meeting_type?: string | null;
};

export type TarefaDraft = {
  titulo: string;
  descricao?: string | null;
  owner?: string;
  acao?: Acao;
  prazo?: string | null;
  prazo_text?: string | null;
  prioridade?: Tarefa["prioridade"];
  pessoas?: string[] | { nome: string; principal?: boolean }[];
  frente_id?: string | null;
  area_raw?: string | null;
  precisa_revisao?: boolean;
  meeting_id?: string | null;
};

export type CriarMeta = {
  origem: "manual" | "captura_texto" | "captura_voz" | "agente" | "hermes";
  raw?: string;
  confidence?: "high" | "medium" | "low";
};

export type Pessoa = {
  id: string;
  user_id: string;
  nome: string;
  aliases: string[];
  is_vitor: boolean;
  notas: string | null;
  created_at: string;
  updated_at: string;
};

export type VoiceSample = {
  id: string;
  user_id: string;
  pessoa_id: string;
  embedding: number[];
  source_meeting_id: string | null;
  source_speaker_letter: string | null;
  source_segment_range: string | null;
  duration_seconds: number | null;
  soft_deleted_at: string | null;
  created_at: string;
};

// ─── TAREFA_SELECT (fragmento canônico) ───────────────────────────────

// SELECT canônico de uma tarefa serializada (frente + pessoas agregadas).
// Use com um WHERE depois. Mantém o shape idêntico em recentes/criar.
const TAREFA_SELECT = `
  SELECT t.*,
         to_char(m.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS meeting_recorded_at,
         m.summary AS meeting_summary,
         m.meeting_type AS meeting_type,
         f.nome AS frente,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'principal', tp.principal)
                            ORDER BY tp.principal DESC, p.nome)
           FROM tarefa_pessoas tp JOIN pessoas p ON p.id = tp.pessoa_id
           WHERE tp.tarefa_id = t.id
         ), '[]'::jsonb) AS pessoas
    FROM tarefas t
    LEFT JOIN meetings m ON m.id = t.meeting_id
    LEFT JOIN frentes f ON f.id = t.frente_id`;

// ─── meetingsFor ──────────────────────────────────────────────────────
// Queries NÃO precisam de WHERE user_id — RLS filtra automaticamente.

export const meetingsFor = (userId: string) => ({
  /** Lista (filhos arquivados ficam fora — archived_session é o status do pai). */
  list: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<Meeting>(
        `SELECT * FROM meetings
         WHERE status != 'archived_session'
         ORDER BY recorded_at DESC NULLS LAST, created_at DESC
         LIMIT 100`,
      );
      return r.rows;
    }),

  byId: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Meeting>(
        `SELECT * FROM meetings WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    }),

  /** Hard delete: apaga a reunião + segmentos-filhos. tarefas/eventos caem por FK CASCADE.
   *  Retorna os audio_paths (alvo + filhos) pra o handler apagar do volume. */
  deleteCascade: (id: string) =>
    withTenant(userId, async (db) => {
      const paths = await db.query<{ audio_path: string | null }>(
        `SELECT audio_path FROM meetings WHERE id = $1 OR parent_meeting_id = $1`,
        [id],
      );
      const del = await db.query<{ id: string }>(
        `DELETE FROM meetings WHERE id = $1 OR parent_meeting_id = $1 RETURNING id`,
        [id],
      );
      return {
        deleted: del.rowCount ?? 0,
        audioPaths: paths.rows
          .map((r) => r.audio_path)
          .filter((p): p is string => Boolean(p)),
      };
    }),

  /** Versão pra página de detalhe — recorded_at já formatado pra ISO UTC. */
  byIdDetailed: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{
        id: string;
        source: string;
        meeting_type: string | null;
        original_filename: string;
        recorded_at: string | null;
        created_at: string;
        status: string;
        status_error: string | null;
        transcription: string | null;
        summary: string | null;
        executive_summary: string | null;
        duration_seconds: number | null;
        segments: unknown;
        speaker_labels: Record<string, string> | null;
        speaker_labels_proposed: Record<string, unknown> | null;
        sections: unknown;
      }>(
        `SELECT
           id, source, meeting_type, original_filename,
           to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           status, status_error, transcription, summary,
           raw_ai_response->>'executive_summary' AS executive_summary,
           duration_seconds, segments,
           speaker_labels, speaker_labels_proposed, sections
         FROM meetings WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    }),

  /** Dados crus pra export (segments, labels, summary, recorded_at ISO, sections). */
  forExport: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{
        summary: string | null;
        duration_seconds: number | null;
        recorded_at: string | null;
        segments: unknown;
        speaker_labels: Record<string, string> | null;
        sections: unknown;
      }>(
        `SELECT summary, duration_seconds,
                to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
                segments, speaker_labels, sections
         FROM meetings WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    }),

  /** Salva o array completo de seções (replace). Retorna a linha atualizada ou null. */
  updateSections: (id: string, sections: { start_seconds: number; title: string }[]) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{ id: string }>(
        `UPDATE meetings SET sections = $2::jsonb WHERE id = $1 RETURNING id`,
        [id, JSON.stringify(sections)],
      );
      return r.rows[0] ?? null;
    }),

  updateSpeakerLabels: (
    id: string,
    speakerLabels: Record<string, string>,
    speakerPessoas: Record<string, string>,
  ) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Meeting>(
        `UPDATE meetings
           SET speaker_labels = $2, speaker_pessoas = $3
         WHERE id = $1
         RETURNING *`,
        [id, JSON.stringify(speakerLabels), JSON.stringify(speakerPessoas)],
      );
      return r.rows[0] ?? null;
    }),

  /** Listagem pra `/reunioes` com contagem de tarefas joinadas. */
  listForIndex: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<{
        id: string;
        source: string;
        meeting_type: string | null;
        recorded_at: string | null;
        created_at: string;
        status: string;
        summary: string | null;
        duration_seconds: number | null;
        needs_segmentation: boolean;
        n_tarefas: number;
        n_minhas: number;
      }>(
        `SELECT
           m.id, m.source, m.meeting_type,
           to_char(coalesce(m.recorded_at, m.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
           to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           m.status, m.summary, m.duration_seconds, m.needs_segmentation,
           (SELECT count(*) FROM tarefas WHERE meeting_id = m.id)::int AS n_tarefas,
           (SELECT count(*) FROM tarefas WHERE meeting_id = m.id AND acao IN ('executar','cobrar'))::int AS n_minhas
         FROM meetings m
         WHERE m.status != 'archived_session'
         ORDER BY coalesce(m.recorded_at, m.created_at) DESC
         LIMIT 100`,
      );
      return r.rows;
    }),

  /** Busca reuniões por resumo/transcrição/arquivo (usada pelo agente). */
  buscar: (q: string, limite = 15) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{
        id: string;
        recorded_at: string | null;
        summary: string | null;
        meeting_type: string | null;
        duration_seconds: number | null;
      }>(
        `SELECT id,
                to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
                summary, meeting_type, duration_seconds
         FROM meetings
         WHERE status != 'archived_session'
           AND (summary ILIKE $1 OR transcription ILIKE $1 OR original_filename ILIKE $1)
         ORDER BY coalesce(recorded_at, created_at) DESC LIMIT $2`,
        [`%${q}%`, limite],
      );
      return r.rows;
    }),
});

// ─── tarefasFor ───────────────────────────────────────────────────────

export const tarefasFor = (userId: string) => ({
  /** Tarefas recentes — inclui abertas E concluídas/canceladas. UI filtra por status. */
  recentes: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<
        Tarefa & {
          meeting_recorded_at: string | null;
          meeting_summary: string | null;
        }
      >(
        `${TAREFA_SELECT}
          ORDER BY (t.status NOT IN ('aberta','em_andamento')),
                   (t.acao = 'aguardar'),
                   (t.prazo IS NULL), t.prazo ASC, t.created_at DESC
          LIMIT 300`,
      );
      return r.rows;
    }),

  /** Cria uma tarefa (manual ou captura) e devolve a Tarefa COMPLETA serializada.
   *  meeting_id é sempre NULL aqui (tarefa não vem de reunião). */
  criar: (draft: TarefaDraft, meta: CriarMeta) =>
    withTenant(userId, async (db) => {
      const pessoasRaw = Array.isArray(draft.pessoas) && typeof draft.pessoas[0] === "string"
        ? JSON.stringify(draft.pessoas)
        : null;

      const ins = await db.query<{ id: string }>(
        `INSERT INTO tarefas
           (user_id, titulo, descricao, owner, acao, prazo, prazo_text, prioridade,
            frente_id, area_raw, pessoas_raw, precisa_revisao, meeting_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          userId,
          draft.titulo.trim(),
          draft.descricao?.trim() || null,
          (draft.owner ?? "vitor").trim() || "vitor",
          draft.acao ?? "executar",
          draft.prazo ?? null,
          draft.prazo_text?.trim() || null,
          draft.prioridade ?? "media",
          draft.frente_id ?? null,
          draft.area_raw?.trim() || null,
          pessoasRaw,
          draft.precisa_revisao ?? false,
          draft.meeting_id ?? null,
        ],
      );
      const id = ins.rows[0].id;

      await db.query(
        "INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,'criada',$2)",
        [id, JSON.stringify({ origem: meta.origem, raw: meta.raw ?? null, confidence: meta.confidence ?? null })],
      );

      // Caminho manual: pessoas como objetos {nome, principal} (com flag principal explícita).
      if (Array.isArray(draft.pessoas) && draft.pessoas.length > 0 && typeof draft.pessoas[0] !== "string") {
        for (const p of draft.pessoas as { nome: string; principal?: boolean }[]) {
          const nome = (p.nome || "").trim();
          if (!nome || nome === "?") continue;
          const pr = await db.query<{ id: string }>(
            `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
             ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
            [userId, nome],
          );
          await db.query(
            `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,$3)
             ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal`,
            [id, pr.rows[0].id, !!p.principal],
          );
        }
      }
      // (caminho captura: pessoas_raw acima → trigger resolve_tarefa_pessoas resolve sozinho)

      const out = await db.query<Tarefa & { meeting_recorded_at: string | null; meeting_summary: string | null }>(
        `${TAREFA_SELECT} WHERE t.id = $1`,
        [id],
      );
      return out.rows[0];
    }),

  byId: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Tarefa>(
        `SELECT * FROM tarefas WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    }),

  update: (
    id: string,
    patch: Partial<
      Pick<Tarefa, "titulo" | "descricao" | "prazo" | "prioridade" | "status">
    >,
  ) =>
    withTenant(userId, async (db) => {
      const fields = Object.keys(patch) as (keyof typeof patch)[];
      if (fields.length === 0) return null;
      const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
      const values = fields.map((f) => patch[f]);
      const r = await db.query<Tarefa>(
        `UPDATE tarefas SET ${sets} WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      return r.rows[0] ?? null;
    }),

  /** Lista tarefas de um meeting. Ordem: suas (executar/cobrar) > aguardando, aberta > finalizada, prazo asc. */
  byMeeting: (meetingId: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<
        Tarefa & { prazo: string | null; created_at: string }
      >(
        `SELECT
           t.id, t.meeting_id, t.titulo, t.descricao, t.owner, t.is_mine, t.acao,
           to_char(t.prazo AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS prazo,
           t.prazo_text, t.prioridade, t.status, t.evidencia,
           to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           f.nome AS frente, t.frente_proposta,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'principal', tp.principal)
                             ORDER BY tp.principal DESC, p.nome)
             FROM tarefa_pessoas tp JOIN pessoas p ON p.id = tp.pessoa_id
             WHERE tp.tarefa_id = t.id
           ), '[]'::jsonb) AS pessoas
         FROM tarefas t
         LEFT JOIN frentes f ON f.id = t.frente_id
         WHERE t.meeting_id = $1
         ORDER BY (t.status NOT IN ('aberta','em_andamento')), (t.acao = 'aguardar'), (t.prazo IS NULL), t.prazo ASC, t.created_at ASC`,
        [meetingId],
      );
      return r.rows;
    }),

  /** Busca simples por título/descrição/owner (usada pelo agente). */
  buscar: (q: string, limite = 30) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Tarefa>(
        `${TAREFA_SELECT}
          WHERE t.titulo ILIKE $1 OR t.descricao ILIKE $1 OR t.owner ILIKE $1
          ORDER BY t.created_at DESC LIMIT $2`,
        [`%${q}%`, limite],
      );
      return r.rows;
    }),

  /** Atualização do AGENTE: campos + status (com evento) + pessoas + recalcula
   *  `principal`. Espelha o PATCH /api/tarefas/[id], marcando `origem` na auditoria.
   *  Retorna a Tarefa serializada ou null se não existe (RLS escopa ao user). */
  atualizar: (
    id: string,
    patch: Partial<{
      titulo: string;
      descricao: string | null;
      owner: string;
      acao: Acao;
      prazo: string | null;
      prazo_text: string | null;
      prioridade: Tarefa["prioridade"];
      status: Tarefa["status"];
      frente_id: string | null;
      pessoas: { nome: string; principal?: boolean }[];
    }>,
    origem = "agente",
  ) =>
    withTenant(userId, async (c) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      const push = (col: string, val: unknown) => {
        values.push(val);
        sets.push(`${col} = $${values.length}`);
      };

      if (patch.titulo !== undefined) push("titulo", patch.titulo);
      if (patch.descricao !== undefined) push("descricao", patch.descricao);
      if (patch.owner !== undefined) push("owner", patch.owner);
      if (patch.acao !== undefined) {
        push("acao", patch.acao);
        // invariante: executar ⇔ tarefa é do Vitor. Sem owner explícito, força "vitor".
        if (patch.acao === "executar" && patch.owner === undefined) push("owner", "vitor");
      }
      if (patch.prazo !== undefined) push("prazo", patch.prazo);
      if (patch.prazo_text !== undefined) push("prazo_text", patch.prazo_text);
      if (patch.prioridade !== undefined) push("prioridade", patch.prioridade);
      if (patch.status !== undefined) {
        push("status", patch.status);
        if (patch.status === "concluida") sets.push("concluida_em = now()");
        if (patch.status === "cancelada") sets.push("cancelada_em = now()");
        if (patch.status === "aberta" || patch.status === "em_andamento") {
          sets.push("concluida_em = NULL", "cancelada_em = NULL");
        }
      }
      if (patch.frente_id !== undefined) {
        push("frente_id", patch.frente_id);
        if (patch.frente_id) sets.push("frente_proposta = NULL");
      }

      const hasPessoas = Array.isArray(patch.pessoas);

      if (sets.length) {
        values.push(id);
        const r = await c.query<{ id: string }>(
          `UPDATE tarefas SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id`,
          values,
        );
        if (!r.rows[0]) return null;
        if (patch.status) {
          const evento =
            patch.status === "concluida"
              ? "concluida"
              : patch.status === "cancelada"
              ? "cancelada"
              : "reaberta";
          await c.query(
            "INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,$2,$3)",
            [id, evento, JSON.stringify({ origem, status: patch.status })],
          );
        } else {
          await c.query(
            "INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,'editada',$2)",
            [id, JSON.stringify({ origem })],
          );
        }
      } else if (!hasPessoas) {
        // nada pra setar nem pessoas → confirma existência e devolve atual
        const r = await c.query<{ id: string }>("SELECT id FROM tarefas WHERE id = $1", [id]);
        if (!r.rows[0]) return null;
      } else {
        const r = await c.query<{ id: string }>("SELECT id FROM tarefas WHERE id = $1", [id]);
        if (!r.rows[0]) return null;
      }

      // mudou dono/ação sem pessoas explícitas → recalcula `principal` (espelha trigger)
      if (!hasPessoas && (patch.owner !== undefined || patch.acao !== undefined)) {
        const cur = (
          await c.query<{ acao: string; owner: string }>(
            "SELECT acao, owner FROM tarefas WHERE id = $1",
            [id],
          )
        ).rows[0];
        const acao = String(cur?.acao ?? "");
        const owner = String(cur?.owner ?? "").trim();
        if (acao === "executar") {
          await c.query(
            "UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1 AND principal",
            [id],
          );
        } else {
          await c.query("UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1", [id]);
          if (owner && owner !== "?" && owner.toLowerCase() !== "vitor") {
            const found = await c.query<{ pessoa_id: string }>(
              `SELECT tp.pessoa_id FROM tarefa_pessoas tp
                 JOIN pessoas p ON p.id = tp.pessoa_id
                WHERE tp.tarefa_id = $1 AND app_slugify(p.nome) = app_slugify($2) LIMIT 1`,
              [id, owner],
            );
            let pessoaId = found.rows[0]?.pessoa_id;
            if (!pessoaId) {
              const pr = await c.query<{ id: string }>(
                `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
                 ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
                [userId, owner],
              );
              pessoaId = pr.rows[0].id;
            }
            await c.query(
              `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,true)
               ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = true`,
              [id, pessoaId],
            );
          }
        }
      }

      if (hasPessoas) {
        await c.query("DELETE FROM tarefa_pessoas WHERE tarefa_id = $1", [id]);
        for (const p of patch.pessoas!) {
          const nome = (p.nome || "").trim();
          if (!nome || nome === "?") continue;
          const pr = await c.query<{ id: string }>(
            `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
             ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
            [userId, nome],
          );
          await c.query(
            `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,$3)
             ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal`,
            [id, pr.rows[0].id, !!p.principal],
          );
        }
      }

      const out = await c.query<Tarefa>(`${TAREFA_SELECT} WHERE t.id = $1`, [id]);
      return out.rows[0] ?? null;
    }),

  /** Atrela UMA pessoa à tarefa (aditivo). Se principal=true, zera os outros principais. */
  atrelarPessoa: (id: string, nome: string, principal = false) =>
    withTenant(userId, async (c) => {
      const exists = await c.query<{ id: string }>("SELECT id FROM tarefas WHERE id = $1", [id]);
      if (!exists.rows[0]) return null;
      const nm = (nome || "").trim();
      if (!nm || nm === "?") return null;
      const pr = await c.query<{ id: string }>(
        `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
         ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
        [userId, nm],
      );
      if (principal) {
        await c.query("UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1", [id]);
      }
      await c.query(
        `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,$3)
         ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal`,
        [id, pr.rows[0].id, principal],
      );
      const out = await c.query<Tarefa>(`${TAREFA_SELECT} WHERE t.id = $1`, [id]);
      return out.rows[0] ?? null;
    }),

  /** Remove a tarefa (apaga eventos antes, como o DELETE individual). Retorna nº apagado. */
  remover: (id: string) =>
    withTenant(userId, async (c) => {
      await c.query("DELETE FROM tarefa_eventos WHERE tarefa_id = $1", [id]);
      const r = await c.query("DELETE FROM tarefas WHERE id = $1 RETURNING id", [id]);
      return r.rowCount ?? 0;
    }),
});

// ─── pessoasFor ───────────────────────────────────────────────────────

export const pessoasFor = (userId: string) => ({
  list: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<Pessoa>(
        `SELECT * FROM pessoas ORDER BY is_vitor DESC, nome ASC`,
      );
      return r.rows;
    }),

  /** Versão enxuta pra selects/dropdowns (só id + nome). */
  listMinimal: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM pessoas ORDER BY is_vitor DESC, nome ASC`,
      );
      return r.rows;
    }),

  /** Listagem completa pro /pessoas com count de meetings e samples. */
  listForIndex: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<{
        id: string;
        nome: string;
        aliases: string[];
        is_vitor: boolean;
        notas: string | null;
        n_reunioes: number;
        sample_count: number;
      }>(
        `SELECT
           p.id, p.nome, p.aliases, p.is_vitor, p.notas,
           COALESCE((
             SELECT count(DISTINCT m.id)::int
             FROM meetings m, jsonb_each_text(m.speaker_pessoas) AS sp(letter, pid)
             WHERE sp.pid = p.id::text
           ), 0) AS n_reunioes,
           COALESCE((
             SELECT count(*)::int FROM voice_samples vs
             WHERE vs.pessoa_id = p.id AND vs.soft_deleted_at IS NULL
           ), 0) AS sample_count
         FROM pessoas p
         ORDER BY p.is_vitor DESC, p.nome ASC`,
      );
      return r.rows;
    }),

  byId: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Pessoa>(
        `SELECT * FROM pessoas WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    }),

  /** Versão com sample_count agregado (pra /pessoas/[id]). */
  byIdWithSampleCount: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{
        id: string;
        nome: string;
        aliases: string[];
        is_vitor: boolean;
        notas: string | null;
        sample_count: number;
      }>(
        `SELECT p.id, p.nome, p.aliases, p.is_vitor, p.notas,
                COALESCE((SELECT count(*)::int FROM voice_samples vs
                          WHERE vs.pessoa_id = p.id AND vs.soft_deleted_at IS NULL), 0) AS sample_count
         FROM pessoas p WHERE p.id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    }),

  create: (nome: string, aliases: string[] = []) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Pessoa>(
        `INSERT INTO pessoas (user_id, nome, aliases)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [userId, nome, aliases],
      );
      return r.rows[0];
    }),

  upsertByName: (nome: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Pessoa>(
        `INSERT INTO pessoas (user_id, nome) VALUES ($1, $2)
         ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now()
         RETURNING *`,
        [userId, nome],
      );
      return r.rows[0];
    }),
});

// ─── voiceSamplesFor ──────────────────────────────────────────────────

export const voiceSamplesFor = (userId: string) => ({
  byPessoa: (pessoaId: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<VoiceSample>(
        `SELECT * FROM voice_samples
         WHERE pessoa_id = $1 AND soft_deleted_at IS NULL
         ORDER BY created_at DESC`,
        [pessoaId],
      );
      return r.rows;
    }),

  /** Versão com summary do meeting joinado (pra /pessoas/[id]). */
  byPessoaWithMeeting: (pessoaId: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{
        id: string;
        source_meeting_id: string | null;
        source_speaker_letter: string | null;
        source_segment_range: string | null;
        duration_seconds: number | null;
        created_at: string;
        meeting_summary: string | null;
        meeting_recorded_at: string | null;
      }>(
        `SELECT vs.id,
                vs.source_meeting_id::text AS source_meeting_id,
                vs.source_speaker_letter,
                vs.source_segment_range,
                vs.duration_seconds,
                to_char(vs.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                m.summary AS meeting_summary,
                to_char(coalesce(m.recorded_at, m.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS meeting_recorded_at
         FROM voice_samples vs
         LEFT JOIN meetings m ON m.id = vs.source_meeting_id
         WHERE vs.pessoa_id = $1 AND vs.soft_deleted_at IS NULL
         ORDER BY vs.created_at DESC`,
        [pessoaId],
      );
      return r.rows;
    }),

  softDelete: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<VoiceSample>(
        `UPDATE voice_samples SET soft_deleted_at = now()
         WHERE id = $1 AND soft_deleted_at IS NULL
         RETURNING *`,
        [id],
      );
      return r.rows[0] ?? null;
    }),

  /** Reatribui sample pra outra pessoa (PATCH /samples/{id}). */
  reassign: (id: string, newPessoaId: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<VoiceSample>(
        `UPDATE voice_samples SET pessoa_id = $2
         WHERE id = $1 AND soft_deleted_at IS NULL
         RETURNING *`,
        [id, newPessoaId],
      );
      return r.rows[0] ?? null;
    }),
});

// ─── frentesFor ───────────────────────────────────────────────────────

export const frentesFor = (userId: string) => ({
  list: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM frentes WHERE ativo ORDER BY ordem, nome`,
      );
      return r.rows;
    }),
  /** get-or-create por slug; retorna a frente. */
  create: (nome: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{ id: string; nome: string }>(
        `INSERT INTO frentes (user_id, nome, slug, ordem)
         VALUES ($1, $2, app_slugify($2), 999)
         ON CONFLICT (user_id, slug) DO UPDATE SET ativo = true
         RETURNING id, nome`,
        [userId, nome.trim()],
      );
      return r.rows[0];
    }),
});

import { withTenant } from "./db";

// ─── Tipos (espelham o schema atual) ──────────────────────────────────

export type Meeting = {
  id: string;
  user_id: string;
  source: "macbook" | "iphone" | "segmented";
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

export type Tarefa = {
  id: string;
  user_id: string;
  meeting_id: string | null;
  titulo: string;
  descricao: string | null;
  owner: string;
  is_mine: boolean;
  prazo: string | null;
  prazo_text: string | null;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  status: "aberta" | "em_andamento" | "concluida" | "cancelada";
  evidencia: string | null;
  created_at: string;
  updated_at: string;
  concluida_em: string | null;
  cancelada_em: string | null;
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
  meeting_id: string | null;
  letter: string | null;
  audio_clip_path: string | null;
  embedding: number[];
  soft_deleted_at: string | null;
  created_at: string;
};

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
});

// ─── tarefasFor ───────────────────────────────────────────────────────

export const tarefasFor = (userId: string) => ({
  abertas: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<
        Tarefa & {
          meeting_recorded_at: string | null;
          meeting_summary: string | null;
        }
      >(
        `SELECT t.*,
                to_char(m.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS meeting_recorded_at,
                m.summary AS meeting_summary
           FROM tarefas t
           LEFT JOIN meetings m ON m.id = t.meeting_id
          WHERE t.status IN ('aberta','em_andamento')
          ORDER BY (t.prazo IS NULL), t.prazo ASC, t.created_at DESC
          LIMIT 200`,
      );
      return r.rows;
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
});

// ─── pessoasFor ───────────────────────────────────────────────────────

export const pessoasFor = (userId: string) => ({
  list: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<Pessoa>(`SELECT * FROM pessoas ORDER BY nome ASC`);
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
});

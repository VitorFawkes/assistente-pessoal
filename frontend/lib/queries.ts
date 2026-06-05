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
  prazo_text: string | null;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  status: "aberta" | "em_andamento" | "concluida" | "cancelada";
  evidencia: string | null;
  frente: string | null;
  frente_proposta: string | null;
  pessoas: TarefaPessoa[];
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
  embedding: number[];
  source_meeting_id: string | null;
  source_speaker_letter: string | null;
  source_segment_range: string | null;
  duration_seconds: number | null;
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
      }>(
        `SELECT
           id, source, meeting_type, original_filename,
           to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           status, status_error, transcription, summary,
           raw_ai_response->>'executive_summary' AS executive_summary,
           duration_seconds, segments,
           speaker_labels, speaker_labels_proposed
         FROM meetings WHERE id = $1`,
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
        `SELECT t.*,
                to_char(m.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS meeting_recorded_at,
                m.summary AS meeting_summary
           FROM tarefas t
           LEFT JOIN meetings m ON m.id = t.meeting_id
          ORDER BY (t.status NOT IN ('aberta','em_andamento')),
                   (t.acao = 'aguardar'),
                   (t.prazo IS NULL), t.prazo ASC, t.created_at DESC
          LIMIT 300`,
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

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { query, withTenant } from "../db";
import { sourceHash } from "./evidence";
import { loadTaskContext, type CoachTask, type CoachTaskEvent } from "./task-context";
import type {
  CoachAnalysis, CoachMeeting, CoachMemory, CoachMessage, CoachProfile,
  CoachReview, Coverage, Evidence, ReviewContent,
} from "./types";

export type CoachProfilePatch = Partial<Pick<CoachProfile,
  "enabled" | "weekly_enabled" | "goals" | "context" | "timezone" | "review_day" | "review_hour"
>>;
export type { CoachTask, CoachTaskEvent } from "./task-context";
export type CoachMeetingContext = CoachMeeting & { summary: string | null };
export type CoachContext = {
  tasks: CoachTask[]; meetings: CoachMeetingContext[];
  analyses: CoachAnalysis[]; messages: CoachMessage[]; events: CoachTaskEvent[]; limitations: string[];
};
export type AnalysisInput = Omit<CoachAnalysis, "id" | "created_at">;
export type MemoryInput = Pick<CoachMemory, "kind" | "content" | "status" | "evidence">;

export class StaleCoachRunError extends Error {
  constructor() { super("O contexto do coach mudou durante a geração. Tente novamente."); this.name = "StaleCoachRunError"; }
}

const PROFILE_COLUMNS = "user_id, enabled, weekly_enabled, goals, context, timezone, review_day, review_hour, revision, last_run_at, last_error, created_at, updated_at";
const REVIEW_COLUMNS = "id, week_start::text, content, model, profile_revision, created_at";
const MEETING_COLUMNS = "id, nome, original_filename, recorded_at, transcription, segments, speaker_labels, speaker_pessoas";
const ELIGIBLE = "status = 'done' AND transcription IS NOT NULL AND length(btrim(transcription)) > 0";
const serial = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bounded = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(value) || min));

async function rows<T extends QueryResultRow>(db: PoolClient, sql: string, values: unknown[] = []): Promise<T[]> {
  return serial((await db.query<T>(sql, values)).rows);
}
async function ensureProfile(db: PoolClient, userId: string) {
  await db.query("INSERT INTO coach_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
}
async function assertRevision(db: PoolClient, userId: string, revision: number) {
  const result = await db.query<{ revision: number; enabled: boolean }>(
    "SELECT revision, enabled FROM coach_profiles WHERE user_id = $1 FOR UPDATE", [userId],
  );
  if (!result.rows[0]?.enabled || result.rows[0].revision !== revision) throw new StaleCoachRunError();
}
async function bumpRevision(db: PoolClient, userId: string) {
  await ensureProfile(db, userId);
  await db.query("UPDATE coach_profiles SET revision = revision + 1, updated_at = now() WHERE user_id = $1", [userId]);
}
async function evidenceHashes(db: PoolClient, userId: string, evidence: Evidence[], lock = false) {
  const ids = [...new Set(evidence.map((e) => e.meeting_id))].sort();
  if (!ids.length) return new Map<string, string>();
  const meetings = await rows<CoachMeeting>(db,
    `SELECT ${MEETING_COLUMNS} FROM meetings WHERE user_id = $1 AND id = ANY($2::uuid[]) AND ${ELIGIBLE}
     ORDER BY id ${lock ? "FOR SHARE" : ""}`, [userId, ids]);
  return new Map(meetings.map((m) => [m.id, sourceHash(m)]));
}
async function assertEvidenceCurrent(db: PoolClient, userId: string, evidence: Evidence[]) {
  const hashes = await evidenceHashes(db, userId, evidence, true);
  if (evidence.some((e) => hashes.get(e.meeting_id) !== e.source_hash)) throw new StaleCoachRunError();
}
type StoredReview = CoachReview & { profile_revision: number };
async function reviewFreshness(db: PoolClient, userId: string, reviews: StoredReview[]) {
  const profile = (await db.query<{revision: number}>("SELECT revision FROM coach_profiles WHERE user_id = $1", [userId])).rows[0];
  const evidence = reviews.flatMap((r) => r.content.observations.flatMap((o) => o.evidence));
  const hashes = await evidenceHashes(db, userId, evidence);
  return reviews.map((review) => ({...review, stale:
    review.profile_revision !== profile?.revision || review.content.observations.some((o) =>
      o.evidence.some((e) => hashes.get(e.meeting_id) !== e.source_hash)),
  }));
}
async function messageFreshness(db: PoolClient, userId: string, messages: CoachMessage[]) {
  const hashes = await evidenceHashes(db,userId,messages.flatMap((m) => m.evidence));
  return messages.map((message) => ({...message, stale:
    message.evidence.some((e) => hashes.get(e.meeting_id) !== e.source_hash),
  }));
}

/** Every data access has both a transaction tenant and an explicit owner filter. */
export function coachStore(userId: string) {
  let ownedLease: string | null = null;
  const tenant = <T>(fn: (db: PoolClient) => Promise<T>) => withTenant(userId, fn);
  const store = {
    profile: () => tenant(async (db) => {
      await ensureProfile(db, userId);
      return (await rows<CoachProfile>(db, `SELECT ${PROFILE_COLUMNS} FROM coach_profiles WHERE user_id = $1`, [userId]))[0];
    }),

    saveProfile: (patch: CoachProfilePatch) => tenant(async (db) => {
      await ensureProfile(db, userId);
      // Whitelist identifiers; never interpolate caller-provided column names.
      const keys = (["enabled", "weekly_enabled", "goals", "context", "timezone", "review_day", "review_hour"] as const)
        .filter((key) => patch[key] !== undefined);
      if (!keys.length) return (await rows<CoachProfile>(db, `SELECT ${PROFILE_COLUMNS} FROM coach_profiles WHERE user_id = $1`, [userId]))[0];
      return (await rows<CoachProfile>(db,
        `UPDATE coach_profiles SET ${keys.map((key, i) => `${key} = $${i + 2}`).join(", ")},
         revision = revision + 1, updated_at = now(), last_error = NULL
         WHERE user_id = $1 RETURNING ${PROFILE_COLUMNS}`, [userId, ...keys.map((key) => patch[key])]))[0];
    }),

    memories: () => tenant(async (db) => {
      const memories = await rows<CoachMemory>(db,
        "SELECT * FROM coach_memories WHERE user_id = $1 ORDER BY updated_at DESC, id", [userId]);
      const hashes = await evidenceHashes(db,userId,memories.flatMap((m) => m.evidence));
      return memories.map((m) => ({...m, stale: m.evidence.some((e) => hashes.get(e.meeting_id) !== e.source_hash)}));
    }),

    // Supplying revision marks a model write; it cannot override a user's prior rejection.
    addMemory: (input: MemoryInput, revision?: number) => tenant(async (db) => {
      if (revision !== undefined) await assertRevision(db, userId, revision);
      else await bumpRevision(db, userId);
      await assertEvidenceCurrent(db,userId,input.evidence);
      const result = await rows<CoachMemory>(db,
        `INSERT INTO coach_memories (user_id, kind, content, status, evidence) VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (user_id, kind, content_hash) DO NOTHING RETURNING *`,
        [userId, input.kind, input.content.trim(), input.status, JSON.stringify(input.evidence)]);
      return result[0] ?? (await rows<CoachMemory>(db,
        "SELECT * FROM coach_memories WHERE user_id = $1 AND kind = $2 AND content_hash = md5(lower(btrim($3)))",
        [userId, input.kind, input.content]))[0];
    }),

    correctMemory: (id: string, content: string, status: CoachMemory["status"]) => tenant(async (db) => {
      // Lock profile first, the same order used by generated writes and reset.
      await bumpRevision(db, userId);
      const result = await rows<CoachMemory>(db,
        `UPDATE coach_memories SET history = history || jsonb_build_array(jsonb_build_object(
          'content', content, 'status', status, 'at', now())),
         evidence = CASE WHEN content IS DISTINCT FROM $3 OR $4 = 'confirmed' THEN '[]'::jsonb ELSE evidence END,
         content = $3, status = $4, updated_at = now()
         WHERE user_id = $1 AND id = $2 RETURNING *`, [userId, id, content.trim(), status]);
      return result[0] ?? null;
    }),

    messages: () => tenant(async (db) => messageFreshness(db,userId,await rows<CoachMessage>(db,
      `SELECT id, role, content, evidence, created_at FROM
        (SELECT * FROM coach_messages WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100) recent
       ORDER BY created_at, id`, [userId]))),

    addMessage: (role: CoachMessage["role"], content: string, evidence: Evidence[] = [], revision?: number) => tenant(async (db) => {
      if (revision !== undefined) await assertRevision(db, userId, revision);
      await assertEvidenceCurrent(db,userId,evidence);
      return (await rows<CoachMessage>(db,
        `INSERT INTO coach_messages (user_id, role, content, evidence) VALUES ($1,$2,$3,$4::jsonb)
         RETURNING id, role, content, evidence, created_at`, [userId, role, content, JSON.stringify(evidence)]))[0];
    }),

    reviews: () => tenant(async (db) => reviewFreshness(db, userId, await rows<StoredReview>(db,
      `SELECT ${REVIEW_COLUMNS} FROM coach_reviews
       WHERE user_id = $1 ORDER BY week_start DESC LIMIT 52`, [userId]))),

    saveReview: (weekStart: string, content: ReviewContent, model: string, revision: number, replace = false) => tenant(async (db) => {
      await assertRevision(db, userId, revision);
      await assertEvidenceCurrent(db,userId,content.observations.flatMap((o) => o.evidence));
      // Retries preserve the review; explicit refresh replaces it atomically in the same calendar slot.
      const result = await rows<StoredReview>(db,
        `INSERT INTO coach_reviews (user_id, week_start, content, model, profile_revision) VALUES ($1,$2,$3::jsonb,$4,$5)
         ON CONFLICT (user_id, week_start) ${replace ? `DO UPDATE SET content = EXCLUDED.content,
           model = EXCLUDED.model, profile_revision = EXCLUDED.profile_revision, created_at = now()` : "DO NOTHING"}
         RETURNING ${REVIEW_COLUMNS}`, [userId, weekStart, JSON.stringify(content), model, revision]);
      const saved = result[0] ?? (await rows<StoredReview>(db,
        `SELECT ${REVIEW_COLUMNS} FROM coach_reviews WHERE user_id = $1 AND week_start = $2`, [userId, weekStart]))[0];
      return (await reviewFreshness(db, userId, [saved]))[0];
    }),

    meetingPage: (limit = 20, offset = 0) => tenant((db) => rows<CoachMeeting>(db,
      `SELECT ${MEETING_COLUMNS} FROM meetings WHERE user_id = $1 AND ${ELIGIBLE}
       ORDER BY recorded_at DESC NULLS LAST, id LIMIT $2 OFFSET $3`, [userId, bounded(limit, 1, 100), bounded(offset, 0, Number.MAX_SAFE_INTEGER)])),

    meetingById: (id: string) => tenant(async (db) => (await rows<CoachMeetingContext>(db,
      `SELECT ${MEETING_COLUMNS}, summary FROM meetings WHERE user_id = $1 AND id = $2 AND ${ELIGIBLE}`, [userId, id]))[0] ?? null),

    analyses: (meetingId?: string) => tenant((db) => rows<CoachAnalysis>(db,
      `SELECT id, meeting_id, source_hash, chunk_index, chunk_count, observations, summary, model, created_at
       FROM coach_analyses WHERE user_id = $1 ${meetingId ? "AND meeting_id = $2" : ""}
       ORDER BY created_at DESC, meeting_id, chunk_index`, meetingId ? [userId, meetingId] : [userId])),

    analysesInPeriod: (from: string, to: string, limit = 200) => tenant(async (db) => {
      const meetings = await rows<CoachMeeting>(db,
        `SELECT ${MEETING_COLUMNS} FROM meetings WHERE user_id = $1 AND ${ELIGIBLE}
         AND coalesce(recorded_at, created_at) >= $2::timestamptz
         AND coalesce(recorded_at, created_at) < $3::timestamptz ORDER BY recorded_at DESC NULLS LAST, id`, [userId, from, to]);
      const hashes = new Map(meetings.map((m) => [m.id, sourceHash(m)]));
      const result = await rows<CoachAnalysis>(db,
        `SELECT id,meeting_id,source_hash,chunk_index,chunk_count,observations,summary,model,created_at
         FROM coach_analyses WHERE user_id = $1 AND meeting_id = ANY($2::uuid[])
         ORDER BY created_at DESC, meeting_id, chunk_index`, [userId, meetings.map((m) => m.id)]);
      const current = result.filter((a) => hashes.get(a.meeting_id) === a.source_hash);
      const selected = current.slice(0, bounded(limit, 1, 1000));
      const selectedIds = new Set(selected.map((a) => a.meeting_id));
      const completed = meetings.filter((m) => {
        const chunks = current.filter((a) => a.meeting_id === m.id);
        return chunks.length > 0 && new Set(chunks.map((a) => a.chunk_index)).size === Math.max(...chunks.map((a) => a.chunk_count));
      }).length;
      return { analyses: selected, meetings: meetings.filter((m) => selectedIds.has(m.id)),
        complete: completed === meetings.length, total_meetings: meetings.length, analyzed_meetings: completed, limitations: [
        `Período consultado: ${meetings.length} reuniões disponíveis, ${completed} integralmente analisadas e ${current.length} partes atuais processadas.`,
        ...(current.length > selected.length ? [`Revisão usa ${selected.length} de ${current.length} partes do período devido ao limite de contexto.`] : []),
        ...(completed < meetings.length ? ["Há reuniões do período ainda não integralmente analisadas; esta avaliação é parcial."] : []),
      ] };
    }),

    saveAnalysis: (input: AnalysisInput, revision: number) => tenant(async (db) => {
      await assertRevision(db, userId, revision);
      // Recheck the source under a row lock so a concurrent speaker correction cannot publish stale attribution.
      const meeting = (await rows<CoachMeeting>(db,
        `SELECT ${MEETING_COLUMNS} FROM meetings WHERE user_id = $1 AND id = $2 AND ${ELIGIBLE} FOR SHARE`, [userId, input.meeting_id]))[0];
      if (!meeting || sourceHash(meeting) !== input.source_hash) throw new StaleCoachRunError();
      const result = await rows<CoachAnalysis>(db,
        `INSERT INTO coach_analyses (user_id,meeting_id,source_hash,chunk_index,chunk_count,observations,summary,model)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT (user_id,meeting_id,source_hash,chunk_index) DO NOTHING
         RETURNING id,meeting_id,source_hash,chunk_index,chunk_count,observations,summary,model,created_at`,
        [userId,input.meeting_id,input.source_hash,input.chunk_index,input.chunk_count,JSON.stringify(input.observations),input.summary,input.model]);
      return result[0] ?? (await rows<CoachAnalysis>(db,
        `SELECT id,meeting_id,source_hash,chunk_index,chunk_count,observations,summary,model,created_at
         FROM coach_analyses WHERE user_id=$1 AND meeting_id=$2 AND source_hash=$3 AND chunk_index=$4`,
        [userId,input.meeting_id,input.source_hash,input.chunk_index]))[0];
    }),

    coverage: () => tenant(async (db): Promise<Coverage> => {
      const analyses = await rows<{ meeting_id: string; source_hash: string; indices: number[]; expected: number }>(db,
        `SELECT meeting_id,source_hash,array_agg(chunk_index) AS indices,max(chunk_count)::int AS expected
         FROM coach_analyses WHERE user_id = $1 GROUP BY meeting_id,source_hash`, [userId]);
      const indexed = new Map(analyses.map((a) => [`${a.meeting_id}:${a.source_hash}`, a]));
      const coverage: Coverage = {total_meetings: 0, analyzed_meetings: 0, analyzed_chunks: 0, pending_meetings: 0};
      // No LIMIT on total history. Page text to bound memory while using the canonical JS hash.
      for (let offset = 0;; offset += 50) {
        const meetings = await rows<CoachMeeting>(db,
          `SELECT ${MEETING_COLUMNS} FROM meetings WHERE user_id = $1 AND ${ELIGIBLE}
           ORDER BY id LIMIT 50 OFFSET $2`, [userId, offset]);
        for (const meeting of meetings) {
          coverage.total_meetings++;
          const found = indexed.get(`${meeting.id}:${sourceHash(meeting)}`);
          if (!found) continue;
          const indices = new Set(found.indices);
          coverage.analyzed_chunks += indices.size;
          if (indices.size === found.expected && Array.from({length: found.expected}, (_, i) => i).every((i) => indices.has(i))) coverage.analyzed_meetings++;
        }
        if (meetings.length < 50) break;
      }
      coverage.pending_meetings = coverage.total_meetings - coverage.analyzed_meetings;
      return coverage;
    }),

    context: (queryText = "") => tenant(async (db): Promise<CoachContext> => {
      const terms = queryText.trim().slice(0, 5000);
      let meetings: CoachMeetingContext[] = [];
      let patternMeetings: CoachMeetingContext[] = [];
      if (terms) {
        // Search learned patterns across all meetings, not only the recent/retrieved transcript subset.
        const candidates = await rows<CoachMeetingContext & { analysis_source_hash: string }>(db,
          `WITH search AS (SELECT array_to_string(tsvector_to_array(to_tsvector('portuguese', $2)), ' | ')::tsquery AS q)
           SELECT ${MEETING_COLUMNS.split(", ").map((c) => `m.${c}`).join(", ")},m.summary,a.source_hash AS analysis_source_hash
           FROM coach_analyses a JOIN meetings m ON m.id = a.meeting_id AND m.user_id = a.user_id, search
           WHERE a.user_id = $1 AND m.user_id = $1 AND m.status = 'done'
             AND m.transcription IS NOT NULL AND length(btrim(m.transcription)) > 0
             AND to_tsvector('portuguese', a.summary || ' ' || a.observations::text) @@ search.q
           ORDER BY ts_rank_cd(to_tsvector('portuguese', a.summary || ' ' || a.observations::text), search.q) DESC,
             m.recorded_at DESC NULLS LAST LIMIT 60`, [userId, terms]);
        const seen = new Set<string>();
        patternMeetings = candidates.filter((m) => {
          if (sourceHash(m) !== m.analysis_source_hash || seen.has(m.id)) return false;
          seen.add(m.id); return true;
        }).slice(0, 4).map((candidate) => {
          const meeting = {...candidate};
          delete (meeting as Partial<typeof candidate>).analysis_source_hash;
          return meeting;
        });
      }
      if (terms) meetings = await rows<CoachMeetingContext>(db,
        `WITH search AS (SELECT array_to_string(tsvector_to_array(to_tsvector('portuguese', $2)), ' | ')::tsquery AS q)
         SELECT ${MEETING_COLUMNS}, summary FROM meetings, search
         WHERE user_id = $1 AND ${ELIGIBLE}
           AND to_tsvector('portuguese', coalesce(nome,'') || ' ' || coalesce(summary,'') || ' ' || transcription) @@ search.q
         ORDER BY ts_rank_cd(to_tsvector('portuguese', coalesce(nome,'') || ' ' || coalesce(summary,'') || ' ' || transcription), search.q) DESC,
           recorded_at DESC NULLS LAST, id LIMIT 8`, [userId, terms]);
      meetings = [...patternMeetings, ...meetings.filter((m) => !patternMeetings.some((p) => p.id === m.id))].slice(0, 8);
      const fallback = terms.length > 0 && meetings.length === 0;
      if (!meetings.length) meetings = await rows<CoachMeetingContext>(db,
        `SELECT ${MEETING_COLUMNS}, summary FROM meetings WHERE user_id = $1 AND ${ELIGIBLE}
         ORDER BY recorded_at DESC NULLS LAST, id LIMIT 8`, [userId]);
      const hashes = new Map(meetings.map((m) => [m.id, sourceHash(m)]));
      const analyses = (await rows<CoachAnalysis>(db,
        `SELECT id,meeting_id,source_hash,chunk_index,chunk_count,observations,summary,model,created_at
         FROM coach_analyses WHERE user_id = $1 AND meeting_id = ANY($2::uuid[])
         ORDER BY created_at DESC, chunk_index`, [userId, meetings.map((m) => m.id)]))
        .filter((a) => hashes.get(a.meeting_id) === a.source_hash).slice(0, 40);
      const {tasks,events} = await loadTaskContext(db,userId);
      const messages = terms ? await rows<CoachMessage>(db,
        `WITH search AS (SELECT array_to_string(tsvector_to_array(to_tsvector('portuguese', $2)), ' | ')::tsquery AS q)
         SELECT id,role,content,evidence,created_at FROM coach_messages, search
         WHERE user_id = $1 AND to_tsvector('portuguese', content) @@ search.q
         ORDER BY ts_rank_cd(to_tsvector('portuguese', content), search.q) DESC, created_at DESC LIMIT 12`, [userId, terms]) : [];
      return { tasks, events, meetings, analyses, messages: await messageFreshness(db,userId,messages), limitations: [
        "Contexto desta resposta: até 8 reuniões recuperadas no histórico completo, 40 análises atuais, 40 tarefas e 40 eventos de tarefas; não é uma leitura simultânea de todo o histórico.",
        "Até 12 mensagens anteriores recuperadas por relevância em todo o histórico da conversa.",
        ...(fallback ? ["A busca textual não encontrou correspondências; contexto de reuniões recentes usado como apoio."] : []),
        "Agenda externa e conversas do agente de tarefas não estão conectadas ao coach.",
      ] };
    }),

    selfPersonIds: () => tenant(async (db) => (await rows<{ id: string }>(db,
      "SELECT id FROM pessoas WHERE user_id = $1 AND is_vitor = true ORDER BY id", [userId])).map((p) => p.id)),

    claimLease: () => tenant(async (db) => {
      const token = randomUUID();
      const result = await db.query(
        `UPDATE coach_profiles SET lease_token = $2, lease_until = now() + interval '10 minutes', last_error = NULL
         WHERE user_id = $1 AND enabled AND (lease_until IS NULL OR lease_until < now()) RETURNING user_id`, [userId, token]);
      if (!result.rowCount) return null;
      ownedLease = token;
      return token;
    }),

    releaseLease: (error?: string, token?: string) => tenant(async (db) => {
      const releasing = token ?? ownedLease;
      if (!releasing) return;
      await db.query(
        `UPDATE coach_profiles SET lease_token = NULL, lease_until = NULL, last_run_at = now(), last_error = $3
         WHERE user_id = $1 AND lease_token = $2`, [userId, releasing, error?.slice(0, 500) ?? null]);
      if (releasing === ownedLease) ownedLease = null;
    }),

    reset: () => tenant(async (db) => {
      await ensureProfile(db, userId);
      // Retain/increment revision to prevent in-flight calls repopulating erased history.
      await db.query(`UPDATE coach_profiles SET enabled=false, weekly_enabled=false, goals='', context='',
        timezone='America/Sao_Paulo', review_day=5, review_hour=17, revision=revision+1,
        lease_token=NULL, lease_until=NULL, last_run_at=NULL, last_error=NULL, updated_at=now() WHERE user_id=$1`, [userId]);
      for (const table of ["coach_memories", "coach_messages", "coach_analyses", "coach_reviews"] as const)
        await db.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }),
  };
  return store;
}

/** Users is an existing system table; profiles are always checked under their own RLS context. */
export async function enabledUserIds(): Promise<string[]> {
  const users = await query<{ id: string }>("SELECT id FROM users WHERE deleted_at IS NULL AND consent_terms_at IS NOT NULL ORDER BY id");
  const enabled: string[] = [];
  for (const user of users) {
    const found = await withTenant(user.id, (db) => db.query<{ user_id: string }>(
      "SELECT user_id FROM coach_profiles WHERE user_id = $1 AND enabled = true", [user.id]));
    if (found.rowCount) enabled.push(user.id);
  }
  return enabled;
}

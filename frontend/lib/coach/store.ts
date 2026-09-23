import { memoryContext as buildMemoryContext, memoriesAt as memoryVersionsAt, inferenceBlocked } from "./memory-policy";
import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { query, withTenant } from "../db";
import { sourceHash } from "./evidence";
import { meetingReport, reportContextHash, reportPeriodFingerprint, reportLineage } from "./meeting-reports";
import { loadTaskContext, type CoachTask, type CoachTaskEvent, type TaskSummary, type TaskSelection } from "./task-context";
import { contextSearchTerms, resolveContextPeriod, type ContextOptions, type ContextPeriod } from "./context-selection";
import type {
  CoachAnalysis, CoachMeeting, CoachMemory, CoachMessage, CoachProfile,
  CoachReview, Coverage, Evidence, ReviewContent, ReportSource, ReportPeriodSource,
} from "./types";

export type CoachProfilePatch = Partial<Pick<CoachProfile,
  "enabled" | "weekly_enabled" | "morning_enabled" | "evening_enabled" | "nudges_enabled" | "morning_hour" | "evening_hour" | "goals" | "context" | "timezone" | "review_day" | "review_hour"
>>;
export type { CoachTask, CoachTaskEvent } from "./task-context";
export type CoachMeetingContext = CoachMeeting & { summary: string | null; context_at?:string;date_basis?:"recorded"|"registered" };
export type CoachContext = {
  tasks: CoachTask[]; meetings: CoachMeetingContext[];
  analyses: CoachAnalysis[]; messages: CoachMessage[]; events: CoachTaskEvent[]; limitations: string[];
  historical_meetings:CoachMeetingContext[]; historical_analyses:CoachAnalysis[];
  task_summary:TaskSummary;task_selection:TaskSelection;
  selection:{period:ContextPeriod|null;meetings:{selected:number;total:number};historical_meetings:{selected:number;total:number};
    analyses:{selected:number;total:number};messages:{selected:number};fallback:boolean};
};
export type AnalysisInput = Omit<CoachAnalysis, "id" | "created_at">;
export type MemoryInput = Pick<CoachMemory, "kind" | "content" | "status" | "evidence">;

export class MemoryPolicyError extends Error { constructor(){ super("Essa interpretação foi corrigida ou descartada por você e não pode ser recriada a partir das mesmas fontes."); this.name="MemoryPolicyError"; } }
export class StaleCoachRunError extends Error {
  constructor() { super("O contexto do coach mudou durante a geração. Tente novamente."); this.name = "StaleCoachRunError"; }
}

const PROFILE_COLUMNS = "user_id, enabled, weekly_enabled, morning_enabled, evening_enabled, nudges_enabled, morning_hour, evening_hour, goals, context, timezone, review_day, review_hour, revision, last_run_at, last_error, created_at, updated_at";
const REVIEW_COLUMNS = "id, week_start::text, content, model, profile_revision, created_at";
const meetingColumns=(alias="") => ["id","nome","original_filename","recorded_at","transcription","segments","speaker_labels","speaker_pessoas","summary"].map(column=>alias+column).join(", ")+`, ${alias}raw_ai_response->>'executive_summary' AS executive_summary`;
const MEETING_COLUMNS=meetingColumns();
const contextDateColumns = (alias = "") => `coalesce(${alias}recorded_at,${alias}created_at) AS context_at,
  CASE WHEN ${alias}recorded_at IS NOT NULL THEN 'recorded' ELSE 'registered' END AS date_basis`;
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
async function advanceOwnJob(db:PoolClient,userId:string,runId?:string,receipt?:string){
 if(!runId)return;
 const exists=(await db.query<{present:boolean}>("SELECT to_regclass('public.coach_jobs') IS NOT NULL AS present")).rows[0].present;
 if(!exists)return;
 const updated=await db.query(`UPDATE coach_jobs j SET profile_revision=p.revision,updated_at=now(),
   payload=CASE WHEN $3::text IS NULL THEN j.payload ELSE jsonb_set(j.payload,'{profile_change_receipt}',to_jsonb(concat_ws(E'\n',nullif(j.payload->>'profile_change_receipt',''),$3::text))) END
   FROM coach_profiles p
   WHERE j.user_id=$1 AND j.id=$2 AND j.status='running' AND p.user_id=j.user_id AND p.enabled AND j.profile_revision=p.revision-1`,[userId,runId,receipt||null]);
 if(!updated.rowCount)throw new StaleCoachRunError();
}
const memorySnapshot = `jsonb_build_array(jsonb_build_object('content',content,'status',status,'lifecycle',lifecycle,'valid_from',valid_from,'valid_until',now(),'evidence',evidence,'origin',origin,'supersedes_id',supersedes_id,'at',now()))`;
async function syncProfileGoals(db:PoolClient,userId:string){
 await db.query(`UPDATE coach_profiles SET goals=coalesce((SELECT string_agg(content,E'\\n' ORDER BY created_at,id) FROM coach_memories WHERE user_id=$1 AND kind='goal' AND status='confirmed' AND lifecycle='active' AND valid_until IS NULL),'') WHERE user_id=$1`,[userId]);
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
async function reportHashes(db:PoolClient,userId:string,references:ReportSource[],lock=false){
 const ids=[...new Set(references.map(reference=>reference.meeting_id))].sort();
 if(!ids.length)return new Map<string,string>();
 const meetings=await rows<CoachMeeting>(db,`SELECT ${MEETING_COLUMNS} FROM meetings WHERE user_id=$1 AND id=ANY($2::uuid[]) AND ${ELIGIBLE} ORDER BY id ${lock?"FOR SHARE":""}`,[userId,ids]);
 return new Map(meetings.map(meeting=>[meeting.id,reportContextHash(meeting)]));
}
async function assertReportSourcesCurrent(db:PoolClient,userId:string,references:ReportSource[]){
 const hashes=await reportHashes(db,userId,references,true);
 if(references.some(reference=>hashes.get(reference.meeting_id)!==reference.context_hash))throw new StaleCoachRunError();
}
async function currentPeriodFingerprint(db:PoolClient,userId:string,from:string,to:string,lock=false){
 const meetings=await rows<CoachMeeting>(db,`SELECT ${MEETING_COLUMNS} FROM meetings WHERE user_id=$1 AND ${ELIGIBLE} AND coalesce(recorded_at,created_at)>=$2::timestamptz AND coalesce(recorded_at,created_at)<$3::timestamptz ORDER BY id ${lock?"FOR SHARE":""}`,[userId,from,to]);
 return reportPeriodFingerprint(meetings);
}
const periodKey=(period:ReportPeriodSource)=>JSON.stringify([period.from,period.to]);
async function periodFingerprints(db:PoolClient,userId:string,periods:ReportPeriodSource[],lock=false){
 const unique=new Map(periods.map(period=>[periodKey(period),period]));
 const fingerprints=new Map<string,string>();
 for(const [key,period] of [...unique].sort(([a],[b])=>a.localeCompare(b)))
  fingerprints.set(key,await currentPeriodFingerprint(db,userId,period.from,period.to,lock));
 return fingerprints;
}
const changedPeriods=(periods:ReportPeriodSource[],fingerprints:Map<string,string>)=>periods.some(period=>fingerprints.get(periodKey(period))!==period.fingerprint);
async function assertReportPeriodsCurrent(db:PoolClient,userId:string,periods:ReportPeriodSource[]){
 if(changedPeriods(periods,await periodFingerprints(db,userId,periods,true)))throw new StaleCoachRunError();
}
type StoredReview = CoachReview & { profile_revision: number };
async function reviewFreshness(db: PoolClient, userId: string, reviews: StoredReview[]) {
  const profile = (await db.query<{revision: number}>("SELECT revision FROM coach_profiles WHERE user_id = $1", [userId])).rows[0];
  const evidence = reviews.flatMap((r) => r.content.observations.flatMap((o) => o.evidence));
  const hashes = await evidenceHashes(db, userId, evidence);
  const reports=await reportHashes(db,userId,reviews.flatMap(review=>review.content.context_sources||[]));
  const fingerprints=await periodFingerprints(db,userId,reportLineage(reviews.map(review=>review.content)).periods);
  const result:StoredReview[]=[];
  for(const review of reviews){
   const periods=reportLineage([review.content]).periods;
   const reportStale=(review.content.context_sources||[]).some(reference=>reports.get(reference.meeting_id)!==reference.context_hash);
   const contextStale=review.content.context_version!==2||reportStale||changedPeriods(periods,fingerprints);
   result.push({...review,stale:contextStale||review.profile_revision!==profile?.revision||review.content.observations.some(o=>o.evidence.some(e=>hashes.get(e.meeting_id)!==e.source_hash))});
  }
  return result;
}
async function messageFreshness(db: PoolClient, userId: string, messages: CoachMessage[]) {
  const hashes = await evidenceHashes(db,userId,messages.flatMap((m) => m.evidence));
  const reports=await reportHashes(db,userId,messages.flatMap(m=>m.context_sources||[]));
  const fingerprints=await periodFingerprints(db,userId,messages.flatMap(message=>message.context_periods||[]));
  return messages.map((message) => {
   const reportStale=(message.context_sources||[]).some(reference=>reports.get(reference.meeting_id)!==reference.context_hash);
   const contextStale=reportStale||changedPeriods(message.context_periods||[],fingerprints);
   return {...message,context_freshness:contextStale?"stale" as const:message.context_version===2?"current" as const:"unknown" as const,stale:contextStale||message.evidence.some((e) => hashes.get(e.meeting_id) !== e.source_hash)};
  });
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

    saveProfile: (patch: CoachProfilePatch,expectedRevision?:number,runId?:string) => tenant(async (db) => {
      if(expectedRevision!==undefined)await assertRevision(db,userId,expectedRevision);
      await ensureProfile(db, userId);
      // Whitelist identifiers; never interpolate caller-provided column names.
      const keys = (["enabled", "weekly_enabled", "morning_enabled", "evening_enabled", "nudges_enabled", "morning_hour", "evening_hour", "goals", "context", "timezone", "review_day", "review_hour"] as const)
        .filter((key) => patch[key] !== undefined);
      if (!keys.length) return (await rows<CoachProfile>(db, `SELECT ${PROFILE_COLUMNS} FROM coach_profiles WHERE user_id = $1`, [userId]))[0];
      if(patch.goals!==undefined){
        const previous=(await db.query<{goals:string}>("SELECT goals FROM coach_profiles WHERE user_id=$1 FOR UPDATE",[userId])).rows[0];
        if(previous.goals!==patch.goals){
          await db.query(`UPDATE coach_memories SET history=history||${memorySnapshot},lifecycle='superseded',valid_until=now(),updated_at=now() WHERE user_id=$1 AND kind='goal' AND lifecycle='active'`,[userId]);
          if(patch.goals.trim())await db.query(`INSERT INTO coach_memories(user_id,kind,content,status,origin) VALUES($1,'goal',$2,'confirmed','user') ON CONFLICT(user_id,kind,content_hash) DO UPDATE SET history=coach_memories.history||jsonb_build_array(jsonb_build_object('content',coach_memories.content,'status',coach_memories.status,'lifecycle',coach_memories.lifecycle,'valid_from',coach_memories.valid_from,'valid_until',now(),'at',now())),status='confirmed',origin='user',lifecycle='active',valid_from=now(),valid_until=NULL,evidence='[]',updated_at=now()`,[userId,patch.goals.trim()]);
        }
      }
      const saved=(await rows<CoachProfile>(db,
        `UPDATE coach_profiles SET ${keys.map((key, i) => `${key} = $${i + 2}`).join(", ")},
         revision = revision + 1, updated_at = now(), last_error = NULL
         WHERE user_id = $1 RETURNING ${PROFILE_COLUMNS}`, [userId, ...keys.map((key) => patch[key])]))[0];
      await advanceOwnJob(db,userId,runId,"Atualizei suas preferências de acompanhamento e configurações do coach.");
      return saved;
    }),

    memories: () => tenant(async (db) => {
      const memories = await rows<CoachMemory>(db,
        "SELECT * FROM coach_memories WHERE user_id = $1 ORDER BY updated_at DESC, id", [userId]);
      const hashes = await evidenceHashes(db,userId,memories.flatMap((m) => m.evidence));
      return memories.map((m) => ({...m, stale: m.evidence.some((e) => hashes.get(e.meeting_id) !== e.source_hash)}));
    }),

    memoriesAt: async(at:string):Promise<CoachMemory[]> => memoryVersionsAt(await store.memories(),at),
    memoryContext: async(at?:string):Promise<ReturnType<typeof buildMemoryContext>> => {
      const [memories,profile]=await Promise.all([store.memories(),store.profile()]);
      return buildMemoryContext(memories,profile.goals,at);
    },

    // Supplying revision marks a model write; it cannot override a user's prior rejection.
    addMemory: (input: MemoryInput, revision?: number) => tenant(async (db) => {
      if (revision !== undefined) await assertRevision(db, userId, revision);
      else await bumpRevision(db, userId);
      await assertEvidenceCurrent(db,userId,input.evidence);
      const existing=(await rows<CoachMemory>(db,"SELECT * FROM coach_memories WHERE user_id=$1 AND kind=$2 AND content_hash=md5(lower(btrim($3)))",[userId,input.kind,input.content]))[0];
      if(existing)return existing;
      if(revision!==undefined&&["pattern","experiment"].includes(input.kind)&&input.status!=="hypothesis")throw new MemoryPolicyError();
      if(revision!==undefined && inferenceBlocked(input,await rows<CoachMemory>(db,"SELECT * FROM coach_memories WHERE user_id=$1",[userId])))throw new MemoryPolicyError();
      const result = await rows<CoachMemory>(db,
        `INSERT INTO coach_memories (user_id, kind, content, status, evidence,origin) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT (user_id, kind, content_hash) DO NOTHING RETURNING *`,
        [userId, input.kind, input.content.trim(), input.status, JSON.stringify(input.evidence),revision===undefined?"user":"inferred"]);
      if(input.kind==="goal")await syncProfileGoals(db,userId);
      return result[0] ?? (await rows<CoachMemory>(db,
        "SELECT * FROM coach_memories WHERE user_id = $1 AND kind = $2 AND content_hash = md5(lower(btrim($3)))",
        [userId, input.kind, input.content]))[0];
    }),

    // Only the service's literal, explicit current-user statements may reach this path.
    // Reaffirmation refreshes a confirmed note; it never silently reverses a correction/rejection.
    rememberUserNote: (input:MemoryInput, revision:number) => tenant(async (db):Promise<CoachMemory> => {
      if (!["goal","context","experiment"].includes(input.kind) || input.status !== "confirmed"
        || !Array.isArray(input.evidence) || input.evidence.length !== 0 || typeof input.content !== "string"
        || input.content.trim().length < 1 || input.content.trim().length > 12000)
        throw new Error("A memória precisa ser uma declaração explícita de objetivo, contexto ou experimento.");
      await assertRevision(db,userId,revision);
      const saved = await rows<CoachMemory>(db,
        `INSERT INTO coach_memories(user_id,kind,content,status,evidence,origin) VALUES($1,$2,$3,'confirmed','[]'::jsonb,'user')
         ON CONFLICT(user_id,kind,content_hash) DO UPDATE SET
           history=coach_memories.history || jsonb_build_array(jsonb_build_object(
             'content',coach_memories.content,'status',coach_memories.status,'at',now())),updated_at=now()
         WHERE coach_memories.user_id=$1 AND coach_memories.status='confirmed' AND coach_memories.lifecycle='active'
         RETURNING *`,[userId,input.kind,input.content.trim()]);
      if(input.kind==="goal")await syncProfileGoals(db,userId);
      return saved[0] ?? (await rows<CoachMemory>(db,
        "SELECT * FROM coach_memories WHERE user_id=$1 AND kind=$2 AND content_hash=md5(lower(btrim($3)))",
        [userId,input.kind,input.content]))[0];
    }),

    correctMemory: (id: string, content: string, status: CoachMemory["status"], expectedRevision?:number,runId?:string) => tenant(async (db) => {
      // Lock profile first, the same order used by generated writes and reset.
      if(expectedRevision!==undefined)await assertRevision(db,userId,expectedRevision);
      await bumpRevision(db, userId);
      const result = await rows<CoachMemory>(db,
        `UPDATE coach_memories SET history = history || ${memorySnapshot},
         evidence = CASE WHEN content IS DISTINCT FROM $3 OR $4 = 'confirmed' THEN '[]'::jsonb ELSE evidence END,
         content = $3, status = $4, origin='user', valid_from=now(), valid_until=CASE WHEN lifecycle='active' THEN NULL ELSE now() END, updated_at = now()
         WHERE user_id = $1 AND id = $2 RETURNING *`, [userId, id, content.trim(), status]);
      if(result[0]?.kind==="goal")await syncProfileGoals(db,userId);
      await advanceOwnJob(db,userId,runId,result[0]?"Corrigi uma memória conforme seu pedido.":undefined);
      return result[0] ?? null;
    }),

    transitionMemory: (id:string,input:{lifecycle:NonNullable<CoachMemory["lifecycle"]>;replacement?:{content:string;kind?:CoachMemory["kind"]}},expectedRevision?:number,runId?:string) => tenant(async(db)=>{
      if(!["active","paused","completed","superseded"].includes(input.lifecycle)||((input.lifecycle==="superseded")!==!!input.replacement))throw new Error("invalid_input");
      if(input.replacement && (!input.replacement.content.trim()||input.replacement.content.length>12000))throw new Error("invalid_input");
      if(expectedRevision!==undefined)await assertRevision(db,userId,expectedRevision);
      await bumpRevision(db,userId);
      const previous=(await rows<CoachMemory>(db,"SELECT * FROM coach_memories WHERE user_id=$1 AND id=$2 FOR UPDATE",[userId,id]))[0];
      if(!previous)return null;
      if(input.lifecycle==="active"&&previous.lifecycle==="superseded")throw new Error("Um objetivo substituído precisa de uma nova decisão explícita para voltar a ser vigente.");
      let current:CoachMemory;
      if(input.replacement){
        const kind=input.replacement.kind||previous.kind;
        if(!["goal","context","pattern","experiment"].includes(kind))throw new Error("invalid_input");
        const exists=(await rows<CoachMemory>(db,"SELECT * FROM coach_memories WHERE user_id=$1 AND kind=$2 AND content_hash=md5(lower(btrim($3)))",[userId,kind,input.replacement.content]))[0];
        if(exists)throw new Error("Já existe uma memória com esse conteúdo; revise a memória existente.");
        current=(await rows<CoachMemory>(db,"INSERT INTO coach_memories(user_id,kind,content,status,origin,supersedes_id) VALUES($1,$2,$3,'confirmed','user',$4) RETURNING *",[userId,kind,input.replacement.content.trim(),id]))[0];
      } else current=previous;
      const updated=(await rows<CoachMemory>(db,`UPDATE coach_memories SET history=history||${memorySnapshot},lifecycle=$3,valid_from=CASE WHEN $3='active' THEN now() ELSE valid_from END,valid_until=CASE WHEN $3='active' THEN NULL ELSE now() END,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *`,[userId,id,input.lifecycle]))[0];
      if(previous.kind==="goal"||current.kind==="goal")await syncProfileGoals(db,userId);
      const revision=(await db.query<{revision:number}>("SELECT revision FROM coach_profiles WHERE user_id=$1",[userId])).rows[0].revision;
      const action=input.lifecycle==="paused"?"Pausei":input.lifecycle==="completed"?"Marquei como concluído":input.lifecycle==="superseded"?"Substituí":"Reativei";
      await advanceOwnJob(db,userId,runId,action+(previous.kind==="goal"?" um objetivo":" uma memória")+" e preservei o histórico.");
      return {previous:updated,current:input.replacement?current:updated,revision};
    }),

    messages: () => tenant(async (db) => messageFreshness(db,userId,await rows<CoachMessage>(db,
      `SELECT id, role, content, evidence, context_sources,context_periods,context_version, created_at FROM
        (SELECT * FROM coach_messages WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100) recent
       ORDER BY created_at, id`, [userId]))),

    // Select user replies before applying the bound: generated check-ins cannot evict them.
    userMessages: () => tenant((db) => rows<CoachMessage>(db,
      `SELECT id,role,content,evidence,created_at FROM
        (SELECT * FROM coach_messages WHERE user_id=$1 AND role='user' ORDER BY created_at DESC,id DESC LIMIT 100) recent
       ORDER BY created_at,id`,[userId])),

    runReceipt:(runId:string)=>tenant(async(db)=>{
      const exists=(await db.query<{present:boolean}>("SELECT to_regclass('public.coach_jobs') IS NOT NULL AS present")).rows[0].present;
      if(!exists)return null;
      const result=(await db.query<{receipt:string|null}>("SELECT payload->>'profile_change_receipt' AS receipt FROM coach_jobs WHERE user_id=$1 AND id=$2",[userId,runId])).rows[0];
      return result?.receipt||null;
    }),
    messageByKey:(key:string)=>tenant(async(db)=>(await rows<CoachMessage>(db,"SELECT id,role,content,evidence,context_sources,context_periods,context_version,idempotency_key,created_at FROM coach_messages WHERE user_id=$1 AND idempotency_key=$2",[userId,key]))[0]??null),
    addMessage: (role: CoachMessage["role"], content: string, evidence: Evidence[] = [], revision?: number,idempotencyKey?:string,contextSources:ReportSource[]=[],contextPeriods:ReportPeriodSource[]=[]) => tenant(async (db) => {
      if (revision !== undefined) await assertRevision(db, userId, revision);
      await assertEvidenceCurrent(db,userId,evidence);
      await assertReportSourcesCurrent(db,userId,contextSources);
      await assertReportPeriodsCurrent(db,userId,contextPeriods);
      if(idempotencyKey!==undefined&&(!idempotencyKey||idempotencyKey.length>200))throw new Error("invalid_input");
      const inserted=(await rows<CoachMessage>(db,
        `INSERT INTO coach_messages (user_id, role, content, evidence,idempotency_key,context_sources,context_periods,context_version) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,2)
         ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id, role, content, evidence, context_sources,context_periods,context_version, idempotency_key,created_at`, [userId, role, content, JSON.stringify(evidence),idempotencyKey??null,JSON.stringify(contextSources),JSON.stringify(contextPeriods)]))[0];
      if(inserted)return inserted;
      const existing=(await rows<CoachMessage>(db,"SELECT id,role,content,evidence,context_sources,context_periods,context_version,idempotency_key,created_at FROM coach_messages WHERE user_id=$1 AND idempotency_key=$2",[userId,idempotencyKey]))[0];
      if(!existing||existing.role!==role||existing.content!==content)throw new Error("Chave de mensagem já usada para outro conteúdo.");
      return existing;
    }),

    reviews: () => tenant(async (db) => reviewFreshness(db, userId, await rows<StoredReview>(db,
      `SELECT ${REVIEW_COLUMNS} FROM coach_reviews
       WHERE user_id = $1 ORDER BY week_start DESC LIMIT 52`, [userId]))),

    saveReview: (weekStart: string, content: ReviewContent, model: string, revision: number, replace = false) => tenant(async (db) => {
      await assertRevision(db, userId, revision);
      await assertEvidenceCurrent(db,userId,content.observations.flatMap((o) => o.evidence));
      await assertReportSourcesCurrent(db,userId,content.context_sources||[]);
      await assertReportPeriodsCurrent(db,userId,reportLineage([content]).periods);
      // Retries preserve the review; explicit refresh replaces it atomically in the same calendar slot.
      const result = await rows<StoredReview>(db,
        `INSERT INTO coach_reviews (user_id, week_start, content, model, profile_revision) VALUES ($1,$2,$3::jsonb,$4,$5)
         ON CONFLICT (user_id, week_start) ${replace ? `DO UPDATE SET content = EXCLUDED.content,
           model = EXCLUDED.model, profile_revision = EXCLUDED.profile_revision, created_at = now()` : "DO NOTHING"}
         RETURNING ${REVIEW_COLUMNS}`, [userId, weekStart, JSON.stringify({...content,context_version:2}), model, revision]);
      const saved = result[0] ?? (await rows<StoredReview>(db,
        `SELECT ${REVIEW_COLUMNS} FROM coach_reviews WHERE user_id = $1 AND week_start = $2`, [userId, weekStart]))[0];
      return (await reviewFreshness(db, userId, [saved]))[0];
    }),

    meetingPage: (limit = 20, offset = 0) => tenant((db) => rows<CoachMeeting>(db,
      `SELECT ${MEETING_COLUMNS} FROM meetings WHERE user_id = $1 AND ${ELIGIBLE}
       ORDER BY recorded_at DESC NULLS LAST, id LIMIT $2 OFFSET $3`, [userId, bounded(limit, 1, 100), bounded(offset, 0, Number.MAX_SAFE_INTEGER)])),

    recentMeetingReports: (since: string) => tenant((db) => rows<{ id: string; nome: string | null; original_filename: string; at: Date; summary: string | null; executive_summary: string | null }>(db,
      `SELECT id, nome, original_filename, coalesce(recorded_at, created_at) AS at, summary, raw_ai_response->>'executive_summary' AS executive_summary
       FROM meetings WHERE user_id = $1 AND ${ELIGIBLE} AND coalesce(recorded_at, created_at) >= $2::timestamptz
       ORDER BY coalesce(recorded_at, created_at), id LIMIT 20`, [userId, since])),

    meetingById: (id: string) => tenant(async (db) => (await rows<CoachMeetingContext>(db,
      `SELECT ${MEETING_COLUMNS},${contextDateColumns()} FROM meetings WHERE user_id = $1 AND id = $2 AND ${ELIGIBLE}`, [userId, id]))[0] ?? null),

    analyses: (meetingId?: string) => tenant((db) => rows<CoachAnalysis>(db,
      `SELECT id, meeting_id, source_hash, chunk_index, chunk_count, observations, summary, model, created_at
       FROM coach_analyses WHERE user_id = $1 ${meetingId ? "AND meeting_id = $2" : ""}
       ORDER BY created_at DESC, meeting_id, chunk_index`, meetingId ? [userId, meetingId] : [userId])),

    analysesInPeriod: (from: string, to: string, limit = 200) => tenant(async (db) => {
      const meetings = await rows<CoachMeetingContext>(db,
        `SELECT ${MEETING_COLUMNS},${contextDateColumns()} FROM meetings WHERE user_id = $1 AND ${ELIGIBLE}
         AND coalesce(recorded_at, created_at) >= $2::timestamptz
         AND coalesce(recorded_at, created_at) < $3::timestamptz ORDER BY recorded_at DESC NULLS LAST, id`, [userId, from, to]);
      const hashes = new Map(meetings.map((m) => [m.id, sourceHash(m)]));
      const result = await rows<CoachAnalysis>(db,
        `SELECT id,meeting_id,source_hash,chunk_index,chunk_count,observations,summary,model,created_at
         FROM coach_analyses WHERE user_id = $1 AND meeting_id = ANY($2::uuid[])
         ORDER BY created_at DESC, meeting_id, chunk_index`, [userId, meetings.map((m) => m.id)]);
      const current = result.filter((a) => hashes.get(a.meeting_id) === a.source_hash);
      const selected = current.slice(0, bounded(limit, 1, 1000));
      const completed = meetings.filter((m) => {
        const chunks = current.filter((a) => a.meeting_id === m.id);
        return chunks.length > 0 && new Set(chunks.map((a) => a.chunk_index)).size === Math.max(...chunks.map((a) => a.chunk_count));
      }).length;
      return { analyses: selected, meetings, report_fingerprint:reportPeriodFingerprint(meetings),
        complete: true, behavioral_complete:completed === meetings.length, total_meetings: meetings.length, analyzed_meetings: completed, limitations: [
        ...(meetings.some(meeting=>meeting.date_basis==="registered")?["Reuniões com date_basis=registered usam a data de cadastro/importação; isso não comprova que aconteceram no período desta revisão."]:[]),
        `Período consultado: ${meetings.length} reuniões disponíveis, ${meetings.filter(m=>meetingReport(m).kind!=="missing").length} com relatório/resumo e ${completed} com análise comportamental integral anterior.`,
        ...(current.length > selected.length ? [`Revisão usa ${selected.length} de ${current.length} partes do período devido ao limite de contexto.`] : []),
        ...(completed < meetings.length ? ["A leitura comportamental é seletiva; não houve análise de toda a transcrição de cada reunião."] : []),
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
      const coverage: Coverage = {total_meetings: 0, analyzed_meetings: 0, analyzed_chunks: 0, pending_meetings: 0, report_ready_meetings:0, executive_report_meetings:0, summary_only_meetings:0, missing_report_meetings:0};
      // No LIMIT on total history. Page text to bound memory while using the canonical JS hash.
      for (let offset = 0;; offset += 50) {
        const meetings = await rows<CoachMeeting>(db,
          `SELECT ${MEETING_COLUMNS} FROM meetings WHERE user_id = $1 AND ${ELIGIBLE}
           ORDER BY id LIMIT 50 OFFSET $2`, [userId, offset]);
        for (const meeting of meetings) {
          coverage.total_meetings++;
          const report=meetingReport(meeting);
          if(report.kind!=="missing")coverage.report_ready_meetings!++;
          if(report.kind==="executive_summary")coverage.executive_report_meetings!++;
          if(report.kind==="summary")coverage.summary_only_meetings!++;
          if(report.kind==="missing")coverage.missing_report_meetings!++;
          const found = indexed.get(`${meeting.id}:${sourceHash(meeting)}`);
          if (!found){if(report.kind==="missing")coverage.pending_meetings++;continue;}
          const indices = new Set(found.indices);
          coverage.analyzed_chunks += indices.size;
          if (indices.size === found.expected && Array.from({length: found.expected}, (_, i) => i).every((i) => indices.has(i))) coverage.analyzed_meetings++;
          else if(report.kind==="missing")coverage.pending_meetings++;
        }
        if (meetings.length < 50) break;
      }
      return coverage;
    }),

    context: (queryText = "", options:ContextOptions = {}) => tenant(async (db): Promise<CoachContext> => {
      const now = options.now ?? new Date();
      const timezone = options.timezone ?? (await rows<{timezone:string}>(db,"SELECT timezone FROM coach_profiles WHERE user_id=$1",[userId]))[0]?.timezone ?? "America/Sao_Paulo";
      const period = resolveContextPeriod(queryText,{...options,now,timezone});
      const terms = contextSearchTerms(queryText);
      let meetings: CoachMeetingContext[] = [];
      let patternMeetings: CoachMeetingContext[] = [];
      let historicalMeetings:CoachMeetingContext[] = [];
      if (terms && !period) {
        // Search learned patterns across all meetings, not only the recent/retrieved transcript subset.
        const candidates = await rows<CoachMeetingContext & { analysis_source_hash: string }>(db,
          `WITH search AS (SELECT array_to_string(tsvector_to_array(to_tsvector('portuguese', $2)), ' | ')::tsquery AS q)
           SELECT ${meetingColumns("m.")},${contextDateColumns("m.")},a.source_hash AS analysis_source_hash
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
      if (terms && !period) meetings = await rows<CoachMeetingContext>(db,
        `WITH search AS (SELECT array_to_string(tsvector_to_array(to_tsvector('portuguese', $2)), ' | ')::tsquery AS q)
         SELECT ${MEETING_COLUMNS},${contextDateColumns()} FROM meetings, search
         WHERE user_id = $1 AND ${ELIGIBLE}
           AND to_tsvector('portuguese', coalesce(nome,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(raw_ai_response->>'executive_summary','') || ' ' || transcription) @@ search.q
         ORDER BY ts_rank_cd(to_tsvector('portuguese', coalesce(nome,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(raw_ai_response->>'executive_summary','') || ' ' || transcription), search.q) DESC,
           recorded_at DESC NULLS LAST, id LIMIT 8`, [userId, terms]);
      meetings = [...patternMeetings, ...meetings.filter((m) => !patternMeetings.some((p) => p.id === m.id))].slice(0, 8);
      const fallback = !period && terms.length > 0 && meetings.length === 0;
      if (period) {
        meetings = await rows<CoachMeetingContext>(db,
          `SELECT ${MEETING_COLUMNS},${contextDateColumns()} FROM meetings
           WHERE user_id=$1 AND ${ELIGIBLE} AND coalesce(recorded_at,created_at)>=$2::timestamptz
             AND coalesce(recorded_at,created_at)<$3::timestamptz
           ORDER BY coalesce(recorded_at,created_at) DESC,id`,[userId,period.from,period.to]);
        // Historical material remains a separate field, never a replacement for an empty requested day.
        historicalMeetings = await rows<CoachMeetingContext>(db,
          `SELECT ${MEETING_COLUMNS},${contextDateColumns()} FROM meetings
           WHERE user_id=$1 AND ${ELIGIBLE} AND coalesce(recorded_at,created_at)<$2::timestamptz
           ORDER BY CASE WHEN $3::text='' THEN 0 ELSE ts_rank_cd(
             to_tsvector('portuguese',coalesce(nome,'')||' '||coalesce(summary,'')||' '||coalesce(raw_ai_response->>'executive_summary','')||' '||transcription),
             array_to_string(tsvector_to_array(to_tsvector('portuguese',$3)), ' | ')::tsquery) END DESC,
             coalesce(recorded_at,created_at) DESC,id LIMIT 4`,[userId,period.from,terms]);
      } else if (!meetings.length) meetings = await rows<CoachMeetingContext>(db,
        `SELECT ${MEETING_COLUMNS},${contextDateColumns()} FROM meetings WHERE user_id = $1 AND ${ELIGIBLE}
         ORDER BY recorded_at DESC NULLS LAST, id LIMIT 8`, [userId]);
      if(!period){
        // General guidance still sees every recent meeting, even when keyword search misses its report.
        const recent=await rows<CoachMeetingContext>(db,`SELECT ${MEETING_COLUMNS},${contextDateColumns()} FROM meetings WHERE user_id=$1 AND ${ELIGIBLE} AND coalesce(recorded_at,created_at)>=$2::timestamptz-interval '7 days' AND coalesce(recorded_at,created_at)<=$2::timestamptz ORDER BY coalesce(recorded_at,created_at) DESC,id`,[userId,now.toISOString()]);
        meetings=[...meetings,...recent.filter(meeting=>!meetings.some(selected=>selected.id===meeting.id))];
      }
      const allMeetings = [...meetings,...historicalMeetings];
      const hashes = new Map(allMeetings.map((m) => [m.id, sourceHash(m)]));
      const allAnalyses = (await rows<CoachAnalysis>(db,
        `SELECT id,meeting_id,source_hash,chunk_index,chunk_count,observations,summary,model,created_at
         FROM coach_analyses WHERE user_id = $1 AND meeting_id = ANY($2::uuid[])
         ORDER BY created_at DESC, chunk_index`, [userId, allMeetings.map((m) => m.id)]))
        .filter((a) => hashes.get(a.meeting_id) === a.source_hash);
      const currentIds = new Set(meetings.map(m=>m.id));
      const currentAnalyses = allAnalyses.filter(a=>currentIds.has(a.meeting_id));
      const analyses = currentAnalyses.slice(0,40);
      const historicalAnalyses = allAnalyses.filter(a=>!currentIds.has(a.meeting_id)).slice(0,20);
      const taskContext = await loadTaskContext(db,userId,{now,period,search:terms});
      const counts = (await rows<{total:number;historical:number}>(db,
        `SELECT count(*) FILTER(WHERE $2::timestamptz IS NULL OR (coalesce(recorded_at,created_at)>=$2 AND coalesce(recorded_at,created_at)<$3::timestamptz))::int AS total,
           count(*) FILTER(WHERE $2::timestamptz IS NOT NULL AND coalesce(recorded_at,created_at)<$2)::int AS historical
         FROM meetings WHERE user_id=$1 AND ${ELIGIBLE}`,[userId,period?.from??null,period?.to??null]))[0];
      const messages = terms ? await rows<CoachMessage>(db,
        `WITH search AS (SELECT array_to_string(tsvector_to_array(to_tsvector('portuguese', $2)), ' | ')::tsquery AS q)
         SELECT id,role,content,evidence,context_sources,context_periods,context_version,created_at FROM coach_messages, search
         WHERE user_id = $1 AND to_tsvector('portuguese', content) @@ search.q
         ORDER BY ts_rank_cd(to_tsvector('portuguese', content), search.q) DESC, created_at DESC LIMIT 12`, [userId, terms]) : [];
      return { ...taskContext, meetings, analyses, historical_meetings:historicalMeetings,historical_analyses:historicalAnalyses,
        selection:{period,meetings:{selected:meetings.length,total:counts.total},historical_meetings:{selected:historicalMeetings.length,total:counts.historical},
          analyses:{selected:analyses.length,total:currentAnalyses.length},messages:{selected:messages.length},fallback},
        messages: await messageFreshness(db,userId,messages), limitations: [
        period ? `Período solicitado: ${period.label}, fuso ${timezone}. ${meetings.length} de ${counts.total} reuniões disponíveis selecionadas; ${analyses.length} partes analisadas recuperadas. Sem registros no período não é evidência de inatividade.`
          : `Contexto desta resposta: ${meetings.length} de ${counts.total} reuniões recuperadas no histórico completo e ${analyses.length} análises atuais; não é uma leitura simultânea de todo o histórico.`,
        ...(period ? [`${historicalMeetings.length} reuniões anteriores ao período e ${historicalAnalyses.length} análises históricas servem apenas como referência de padrões; não mostram o que ocorreu no período solicitado.`] : []),
        ...(allMeetings.some(m=>m.date_basis==='registered') ? ["Reuniões com date_basis=registered não têm data de gravação: context_at é a data de cadastro/importação, que não comprova quando a reunião aconteceu."] : []),
        `Panorama agregado de todas as ${taskContext.task_summary.total} tarefas: ${taskContext.task_summary.open} abertas. Detalhes de ${taskContext.tasks.length} tarefas selecionados por prioridade registrada, prazo, relevância e atividade; prioridade registrada não comprova impacto de negócio.`,
        "Carga de execução (mine_open) usa ação executar; carga de acompanhamento (delegated_open) usa cobrar/aguardar. O campo legado is_mine não define o papel atual do usuário.",
        `${taskContext.events.length} de ${taskContext.task_selection.events_total} eventos de tarefas ${period ? "do período" : "do histórico"} recuperados. Tarefas abertas são carga atual, não prova de trabalho realizado; edição do registro não comprova execução. Contagens por frente podem se sobrepor.`,
        "Até 12 mensagens anteriores recuperadas por relevância em todo o histórico da conversa.",
        ...(fallback ? ["A busca textual não encontrou correspondências; contexto de reuniões recentes usado como apoio."] : []),
        "Conversas do agente de tarefas não estão conectadas ao coach. A disponibilidade da agenda está no campo calendar_context.",
      ] };
    }),

    selfPersonIds: () => tenant(async (db) => (await rows<{ id: string }>(db,
      "SELECT id FROM pessoas WHERE user_id = $1 AND is_vitor = true ORDER BY id", [userId])).map((p) => p.id)),

    claimLease: () => tenant(async (db) => {
      const token = randomUUID();
      const result = await db.query(
        `UPDATE coach_profiles SET lease_token = $2, lease_until = now() + interval '15 minutes', last_error = NULL
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
      await db.query(`UPDATE coach_profiles SET enabled=false, weekly_enabled=false, morning_enabled=false,evening_enabled=false,nudges_enabled=false,morning_hour=8,evening_hour=18,goals='', context='',
        timezone='America/Sao_Paulo', review_day=5, review_hour=17, revision=revision+1,
        lease_token=NULL, lease_until=NULL, last_run_at=NULL, last_error=NULL, updated_at=now() WHERE user_id=$1`, [userId]);
      for (const table of ["coach_calendar_cache", "coach_jobs", "coach_semantic_chunks", "coach_model_runs", "coach_commitments", "coach_memories", "coach_messages", "coach_analyses", "coach_reviews"] as const)
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

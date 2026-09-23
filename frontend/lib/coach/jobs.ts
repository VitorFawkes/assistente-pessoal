import { randomUUID } from "node:crypto";
import { withTenant } from "../db";

export type CoachJobKind = "chat" | "analyze" | "review" | "checkin";
export type CheckinKind = "morning" | "evening" | "nudge";
export type CoachJob = { id:string; kind:CoachJobKind; status:"queued"|"running"|"succeeded"|"failed"|"cancelled"; attempts:number; error:string|null; created_at:string; updated_at:string };
export type ClaimedCoachJob = CoachJob & { payload:Record<string,unknown>; lease_token:string; profile_revision:number };
export type JobInput = {kind:CoachJobKind;key:string;payload?:Record<string,unknown>};
export type CadenceProfile = {enabled:boolean;timezone:string;morning_enabled?:boolean;evening_enabled?:boolean;nudges_enabled?:boolean;morning_hour?:number;evening_hour?:number};
const columns="id,kind,status,attempts,error,created_at,updated_at";
export const retryDelaySeconds=(attempt:number)=>Math.min(120,30*2**Math.max(0,attempt-1));
export function publicJob(row:Record<string,unknown>):CoachJob {
 const date=(v:unknown)=>v instanceof Date?v.toISOString():String(v);
 return {id:String(row.id),kind:row.kind as CoachJobKind,status:row.status as CoachJob["status"],attempts:Number(row.attempts),error:typeof row.error==="string"?row.error:null,created_at:date(row.created_at),updated_at:date(row.updated_at)};
}
export function validateJobInput(input:JobInput):Required<JobInput>{
 if(!["chat","analyze","review","checkin"].includes(input.kind)||!input.key||input.key.length>160||!/^[\w:.-]+$/.test(input.key))throw new Error("invalid_input");
 const payload=input.payload||{};
 if(input.kind==="chat"&&(typeof payload.message!=="string"||!payload.message.trim()||payload.message.length>6000))throw new Error("invalid_input");
 if(input.kind==="checkin"&&!["morning","evening","nudge"].includes(String(payload.checkin)))throw new Error("invalid_input");
 return {kind:input.kind,key:input.key,payload:input.kind==="chat"?{message:String(payload.message).trim()}:input.kind==="checkin"?{checkin:payload.checkin}:input.kind==="review"?{force:payload.force===true}: {}};
}
export function dueCheckins(profile:CadenceProfile,now:Date,concreteTrigger:boolean):CheckinKind[]{
 if(!profile.enabled)return [];
 const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:profile.timezone,hour:"numeric",hourCycle:"h23"}).format(now));
 const due:CheckinKind[]=[];
 if(profile.morning_enabled&&hour>=(profile.morning_hour??8)&&hour<(profile.morning_hour??8)+3)due.push("morning");
 if(profile.evening_enabled&&hour>=(profile.evening_hour??18)&&hour<(profile.evening_hour??18)+3)due.push("evening");
 if(!due.length&&profile.nudges_enabled&&concreteTrigger&&hour>=10&&hour<18)due.push("nudge");
 return due;
}
export const localJobDay=(timezone:string,now:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
export async function listJobs(userId:string):Promise<CoachJob[]>{
 return withTenant(userId,async db=>(await db.query(`SELECT ${columns} FROM coach_jobs WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 25`,[userId])).rows.map(publicJob));
}
export async function enqueueJob(userId:string,raw:JobInput):Promise<CoachJob>{
 const input=validateJobInput(raw);
 return withTenant(userId,async db=>{
  const profile=(await db.query("SELECT enabled,revision FROM coach_profiles WHERE user_id=$1 FOR UPDATE",[userId])).rows[0];
  if(!profile?.enabled)throw new Error("Ative o coach para continuar.");
  const old=(await db.query(`SELECT ${columns} FROM coach_jobs WHERE user_id=$1 AND idempotency_key=$2`,[userId,input.key])).rows[0];if(old)return publicJob(old);
  const active=(await db.query(`SELECT ${columns} FROM coach_jobs WHERE user_id=$1 AND kind=$2 AND kind<>'chat' AND status IN ('queued','running') AND profile_revision=$3 LIMIT 1`,[userId,input.kind,profile.revision])).rows[0];if(active)return publicJob(active);
  const row=(await db.query(`INSERT INTO coach_jobs(user_id,kind,idempotency_key,payload,profile_revision) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING ${columns}`,[userId,input.kind,input.key,JSON.stringify(input.payload),profile.revision])).rows[0];return publicJob(row);
 });
}
export async function claimJob(userId:string):Promise<ClaimedCoachJob|null>{
 return withTenant(userId,async db=>{
  const p=(await db.query("SELECT enabled,revision FROM coach_profiles WHERE user_id=$1 FOR UPDATE",[userId])).rows[0];if(!p)return null;
  await db.query(`UPDATE coach_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,error=NULL,updated_at=now() WHERE user_id=$1 AND status IN ('queued','running') AND ($2=false OR (profile_revision<>$3 AND (status='queued' OR lease_until<now())))`,[userId,p.enabled,p.revision]);
  if(!p.enabled)return null;
  await db.query(`UPDATE coach_jobs SET status='failed',lease_token=NULL,lease_until=NULL,error='A execução foi interrompida. Você pode tentar novamente.',updated_at=now() WHERE user_id=$1 AND status='running' AND lease_until<now() AND attempts>=3`,[userId]);
  const running=(await db.query("SELECT id FROM coach_jobs WHERE user_id=$1 AND status='running' AND lease_until>=now() LIMIT 1",[userId])).rowCount;if(running)return null;
  const token=randomUUID();
  const row=(await db.query(`UPDATE coach_jobs SET status='running',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '15 minutes',updated_at=now(),error=NULL
   WHERE id=(SELECT id FROM coach_jobs WHERE user_id=$1 AND attempts<3 AND ((status='queued' AND available_at<=now()) OR (status='running' AND lease_until<now()))
    ORDER BY CASE kind WHEN 'chat' THEN 0 WHEN 'checkin' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
   RETURNING ${columns},payload,lease_token,profile_revision`,[userId,token])).rows[0];
  return row?{...publicJob(row),payload:row.payload,lease_token:row.lease_token,profile_revision:row.profile_revision}:null;
 });
}
export async function renewJob(userId:string,id:string,token:string){
 return withTenant(userId,async db=>!!(await db.query(`UPDATE coach_jobs j SET lease_until=now()+interval '15 minutes' WHERE j.user_id=$1 AND j.id=$2 AND j.lease_token=$3 AND j.status='running' AND j.lease_until>now() AND EXISTS(SELECT 1 FROM coach_profiles p WHERE p.user_id=j.user_id AND p.enabled AND p.revision=j.profile_revision)`,[userId,id,token])).rowCount);
}
export async function finishJob(userId:string,id:string,token:string,result:{error?:string;retry?:boolean;delaySeconds?:number}={}){
 return withTenant(userId,async db=>!!(await db.query(`UPDATE coach_jobs j SET
  status=CASE WHEN $4::text IS NULL THEN 'succeeded' WHEN $5 AND attempts<3 THEN 'queued' ELSE 'failed' END,
  available_at=now()+make_interval(secs=>coalesce($6::int,least(120,30*power(2,greatest(0,attempts-1)))::int)),
  error=$4,lease_token=NULL,lease_until=NULL,updated_at=now()
  WHERE j.user_id=$1 AND j.id=$2 AND j.lease_token=$3 AND j.status='running' AND j.lease_until>now()
   AND EXISTS(SELECT 1 FROM coach_profiles p WHERE p.user_id=j.user_id AND p.enabled AND (p.revision=j.profile_revision OR ($4::text IS NULL AND j.kind IN ('chat','checkin') AND EXISTS(SELECT 1 FROM coach_messages m WHERE m.user_id=j.user_id AND m.role='assistant' AND m.idempotency_key=j.id::text||':assistant'))))`,[userId,id,token,result.error??null,result.retry===true,result.delaySeconds??null])).rowCount);
}
/** Cancellation invalidates in-flight service writes through the profile revision. */
export async function cancelJobs(userId:string,id?:string){
 return withTenant(userId,async db=>{
  await db.query("SELECT user_id FROM coach_profiles WHERE user_id=$1 FOR UPDATE",[userId]);
  const running=(await db.query("SELECT id FROM coach_jobs WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2) AND status='running'",[userId,id??null])).rowCount;
  if(running)await db.query("UPDATE coach_profiles SET revision=revision+1,updated_at=now() WHERE user_id=$1",[userId]);
  return (await db.query(`UPDATE coach_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,error=NULL,updated_at=now() WHERE user_id=$1 AND (status IN ('queued','running') OR (status='failed' AND id=$2)) AND ($2::uuid IS NULL OR id=$2 OR $3)`,[userId,id??null,!!running])).rowCount||0;
 });
}
export async function retryJob(userId:string,id:string){
 return withTenant(userId,async db=>{
  const p=(await db.query("SELECT enabled,revision FROM coach_profiles WHERE user_id=$1 FOR UPDATE",[userId])).rows[0];if(!p?.enabled)return false;
  return !!(await db.query("UPDATE coach_jobs SET status='queued',attempts=0,available_at=now(),error=NULL,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='failed' AND profile_revision=$3",[id,userId,p.revision])).rowCount;
 });
}

export async function clearJobs(userId:string){return withTenant(userId,db=>db.query("DELETE FROM coach_jobs WHERE user_id=$1",[userId]));}

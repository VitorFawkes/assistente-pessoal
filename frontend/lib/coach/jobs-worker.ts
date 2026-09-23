import { withTenant } from "../db";
import { listCommitments } from "./coach-commitments";
import { createHash } from "node:crypto";
import { accountabilityFingerprint, commitmentsDueForFollowup, meetingMentionsCommitment } from "./follow-up";
import { coachStore } from "./store";
import { reviewPeriod } from "./evidence";
import { claimJob,dueCheckins,enqueueJob,finishJob,localJobDay,renewJob,type CadenceProfile,type CheckinKind } from "./jobs";
import { CoachProviderUnavailableError } from "./model";

/** Scheduled work waits past the next 15-minute runner tick; chat answers stay immediate. */
export const PROVIDER_RETRY_DELAY_SECONDS=20*60;

/** Each worker holds only a persisted lease while waiting on the model, never a DB transaction. */
export async function drainJobs(userId:string,options:{maxJobs?:number;deadline?:number}={}){
 const service=await import("./service");
 const maxJobs=Math.max(1,Math.min(5,options.maxJobs??1));const deadline=options.deadline??Date.now()+480000;
 let attempted=0,completed=0,failed=0;
 for(let index=0;index<maxJobs&&Date.now()+30000<deadline;index++){
  const job=await claimJob(userId);if(!job)break;
  attempted++;
  const heartbeat=setInterval(()=>{void renewJob(userId,job.id,job.lease_token).catch(()=>{});},45000);
  try{
   if(job.kind==="chat")await service.chatWithCoach(userId,String(job.payload.message),new Date(),job.id);
   else if(job.kind==="analyze")await service.analyzeMeetings(userId,2);
   else if(job.kind==="review")await service.generateReview(userId,new Date(),job.payload.force===true,job.payload.force!==true);
   else await service.generateCheckin(userId,job.payload.checkin as CheckinKind,new Date(),job.id,typeof job.payload.meeting_id==="string"?job.payload.meeting_id:undefined);
   if(await finishJob(userId,job.id,job.lease_token))completed++;
  }catch(error){
   const unavailable=job.kind!=="chat"&&error instanceof CoachProviderUnavailableError;
   const waitProvider=unavailable&&job.attempts<3;
   const retry=error instanceof service.CoachBusyError||error instanceof service.CoachPendingError||waitProvider;
   const stale=error instanceof service.StaleCoachRunError;
   const message=stale?"Seu contexto mudou durante esta leitura. Faça um novo pedido.":waitProvider?"A IA do coach está indisponível agora. Vou tentar de novo automaticamente.":unavailable?"A IA do coach continuou indisponível. Seu histórico está preservado; tente novamente.":retry?"Aguardando a conclusão das análises em andamento.":"O coach não conseguiu concluir. Seu histórico está preservado; tente novamente.";
   await finishJob(userId,job.id,job.lease_token,{error:message,retry,...(waitProvider?{delaySeconds:PROVIDER_RETRY_DELAY_SECONDS}:{})});
   if(!retry)failed++;
  }finally{clearInterval(heartbeat);}
 }
 return {attempted,completed,failed};
}

/** Existing 15-minute runner calls this. Daily jobs never backfill an obsolete day. */
export async function scheduleCoachJobs(userId:string,now=new Date()){
 const store=coachStore(userId);const profile=await store.profile();if(!profile.enabled)return;
 const coverage=await store.coverage();
 if(coverage.pending_meetings>0)await enqueueJob(userId,{kind:"analyze",key:`scheduled:analyze:${Math.floor(now.getTime()/900000)}:${coverage.analyzed_chunks}:${coverage.pending_meetings}`});
 const commitments=profile.weekly_enabled||profile.nudges_enabled?await listCommitments(userId):[];
 if(profile.weekly_enabled){
  const period=reviewPeriod(now,profile.timezone,profile.review_day,profile.review_hour);
  const week=await store.analysesInPeriod(period.from,period.to);
  const newest=week.analyses.reduce((last,item)=>item.created_at>last?item.created_at:last,"")||"empty";
  const [memories,messages]=await Promise.all([store.memories(),store.userMessages()]);
  const fingerprint=createHash("sha256").update(JSON.stringify([week.report_fingerprint||"legacy",newest,accountabilityFingerprint(commitments,memories,messages)])).digest("hex");
  await enqueueJob(userId,{kind:"review",key:`scheduled:review:${period.weekStart}:${profile.revision}:${fingerprint}`});
 }
 const cadence=profile as typeof profile & CadenceProfile;
 if(!cadence.morning_enabled&&!cadence.evening_enabled&&!cadence.nudges_enabled)return;
 const due=commitmentsDueForFollowup(commitments,now);
 const recent=due.length?await withTenant(userId,async db=>{
  const row=(await db.query(`SELECT EXISTS(SELECT 1 FROM coach_jobs WHERE user_id=$1 AND kind='checkin'
   AND status IN ('queued','running','succeeded') AND updated_at>$2::timestamptz-interval '4 hours') AS recent`,[userId,now.toISOString()])).rows[0];
  return !!row.recent;
 }):false;
 const trigger=due.length>0&&!recent;
 for(const kind of dueCheckins(cadence,now,trigger))await enqueueJob(userId,{kind:"checkin",key:`scheduled:${kind}:${localJobDay(profile.timezone,now)}`,payload:{checkin:kind}});
 // A report of a meeting held after an open agreement and touching its topic gets one follow-up in Ações.
 const open=cadence.nudges_enabled?commitments.filter(c=>["open","renegotiated"].includes(c.status)):[];
 if(!open.length)return;
 for(const meeting of await store.recentMeetingReports(new Date(now.getTime()-24*3600_000).toISOString())){
  const report=meeting.executive_summary||meeting.summary;if(!report)continue;
  const at=new Date(meeting.at).getTime();
  if(open.some(c=>new Date(c.created_at).getTime()<at&&meetingMentionsCommitment(`${meeting.nome||meeting.original_filename} ${report}`,c.title)))
   await enqueueJob(userId,{kind:"checkin",key:`scheduled:meeting:${meeting.id}`,payload:{checkin:"meeting",meeting_id:meeting.id}});
 }
}

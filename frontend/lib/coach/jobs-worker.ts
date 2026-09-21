import { withTenant } from "../db";
import { coachStore } from "./store";
import { reviewPeriod } from "./evidence";
import { claimJob,dueCheckins,enqueueJob,finishJob,localJobDay,renewJob,type CadenceProfile,type CheckinKind } from "./jobs";

/** Each worker holds only a persisted lease while waiting on the model, never a DB transaction. */
export async function drainJobs(userId:string,options:{maxJobs?:number;deadline?:number}={}){
 const service=await import("./service");
 const maxJobs=Math.max(1,Math.min(5,options.maxJobs??1));const deadline=options.deadline??Date.now()+480000;
 let completed=0,failed=0;
 for(let index=0;index<maxJobs&&Date.now()+30000<deadline;index++){
  const job=await claimJob(userId);if(!job)break;
  const heartbeat=setInterval(()=>{void renewJob(userId,job.id,job.lease_token).catch(()=>{});},45000);
  try{
   if(job.kind==="chat")await service.chatWithCoach(userId,String(job.payload.message),new Date(),job.id);
   else if(job.kind==="analyze")await service.analyzeMeetings(userId,2);
   else if(job.kind==="review")await service.generateReview(userId,new Date(),job.payload.force===true,job.payload.force!==true);
   else await service.generateCheckin(userId,job.payload.checkin as CheckinKind,new Date(),job.id);
   if(await finishJob(userId,job.id,job.lease_token))completed++;
  }catch(error){
   const retry=error instanceof service.CoachBusyError||error instanceof service.CoachPendingError;
   const stale=error instanceof service.StaleCoachRunError;
   await finishJob(userId,job.id,job.lease_token,{error:stale?"Seu contexto mudou durante esta leitura. Faça um novo pedido.":retry?"Aguardando a conclusão das análises em andamento.":"O coach não conseguiu concluir. Seu histórico está preservado; tente novamente.",retry});
   if(!retry)failed++;
  }finally{clearInterval(heartbeat);}
 }
 return {completed,failed};
}

/** Existing 15-minute runner calls this. Daily jobs never backfill an obsolete day. */
export async function scheduleCoachJobs(userId:string,now=new Date()){
 const store=coachStore(userId);const profile=await store.profile();if(!profile.enabled)return;
 const coverage=await store.coverage();
 if(coverage.pending_meetings>0)await enqueueJob(userId,{kind:"analyze",key:`scheduled:analyze:${Math.floor(now.getTime()/900000)}:${coverage.analyzed_chunks}:${coverage.pending_meetings}`});
 if(profile.weekly_enabled){
  const period=reviewPeriod(now,profile.timezone,profile.review_day,profile.review_hour);
  const week=await store.analysesInPeriod(period.from,period.to);
  const newest=week.analyses.reduce((last,item)=>item.created_at>last?item.created_at:last,"")||"empty";
  if(week.complete)await enqueueJob(userId,{kind:"review",key:`scheduled:review:${period.weekStart}:${profile.revision}:${newest}`});
 }
 const cadence=profile as typeof profile & CadenceProfile;
 if(!cadence.morning_enabled&&!cadence.evening_enabled&&!cadence.nudges_enabled)return;
 const trigger=await withTenant(userId,async db=>{
  const row=(await db.query(`SELECT
   EXISTS(SELECT 1 FROM meetings WHERE user_id=$1 AND status='done' AND recorded_at>$2::timestamptz-interval '4 hours' AND recorded_at<=$2) AS meeting,
   EXISTS(SELECT 1 FROM tarefas WHERE user_id=$1 AND status NOT IN ('concluida','cancelada') AND prazo<$2::timestamptz AND acao='executar') AS overdue,
   EXISTS(SELECT 1 FROM coach_jobs WHERE user_id=$1 AND kind='checkin' AND status IN ('running','succeeded') AND updated_at>$2::timestamptz-interval '4 hours') AS recent`,[userId,now.toISOString()])).rows[0];
  return !!row.meeting&&!!row.overdue&&!row.recent;
 });
 for(const kind of dueCheckins(cadence,now,trigger))await enqueueJob(userId,{kind:"checkin",key:`scheduled:${kind}:${localJobDay(profile.timezone,now)}`,payload:{checkin:kind}});
}

import {expect,spyOn,test} from "bun:test";
import * as stores from "./store";
import * as jobs from "./jobs";
import * as commitmentStore from "./coach-commitments";
import {drainJobs,PROVIDER_RETRY_DELAY_SECONDS,scheduleCoachJobs} from "./jobs-worker";
import * as service from "./service";
import {CoachProviderUnavailableError} from "./model";
test("backfill can advance twice in one cron slot; weekly uses reports without waiting for behavioral backlog and refreshes versions",async()=>{
 const list=spyOn(commitmentStore,"listCommitments").mockResolvedValue([]);
 let analyzed=2,newest="2026-09-18T10:00:00.000Z",complete=true;
 const requests:jobs.JobInput[]=[];
 const store=spyOn(stores,"coachStore").mockReturnValue({profile:async()=>({enabled:true,weekly_enabled:true,revision:1,timezone:"America/Sao_Paulo",review_day:5,review_hour:17}),coverage:async()=>({pending_meetings:100,analyzed_chunks:analyzed}),memories:async()=>[],userMessages:async()=>[],analysesInPeriod:async()=>({complete,analyses:[{created_at:newest}]})} as unknown as ReturnType<typeof stores.coachStore>);
 const enqueue=spyOn(jobs,"enqueueJob").mockImplementation(async(_user,input)=>{requests.push(input);return {} as jobs.CoachJob;});
 try{
  const now=new Date("2026-09-20T12:00:00Z");await scheduleCoachJobs("owner",now);analyzed=4;newest="2026-09-20T10:00:00.000Z";await scheduleCoachJobs("owner",now);
  expect(requests.map(r=>r.kind)).toEqual(["analyze","review","analyze","review"]);
  expect(requests[0].key).not.toBe(requests[2].key);expect(requests[1].key).not.toBe(requests[3].key);
  complete=false;await scheduleCoachJobs("owner",now);expect(requests.at(-1)?.kind).toBe("review");expect(requests).toHaveLength(6);
 }finally{store.mockRestore();enqueue.mockRestore();list.mockRestore();}
});

test("a due agreement without a meeting queues one nudge, while recent check-ins and closed agreements do not",async()=>{
 const database=await import("../db");
 const commitments=await import("./coach-commitments");
 const requests:jobs.JobInput[]=[];
 let recent=false,status="open";
 const store=spyOn(stores,"coachStore").mockReturnValue({profile:async()=>({enabled:true,weekly_enabled:false,nudges_enabled:true,revision:1,timezone:"America/Sao_Paulo"}),coverage:async()=>({pending_meetings:0}),recentMeetingReports:async()=>[]} as unknown as ReturnType<typeof stores.coachStore>);
 const enqueue=spyOn(jobs,"enqueueJob").mockImplementation(async(_user,input)=>{requests.push(input);return {} as jobs.CoachJob;});
 const list=spyOn(commitments,"listCommitments").mockImplementation(async()=>[{id:"agreement",status,due_at:"2026-09-21T16:00:00Z",outcome:null,updated_at:"2026-09-20T12:00:00Z"}] as never);
 const db=spyOn(database,"withTenant").mockImplementation(async(_user,fn)=>fn({query:async()=>({rows:[{meeting:false,overdue:false,recent}]})} as never));
 try{
  const now=new Date("2026-09-21T17:00:00Z");await scheduleCoachJobs("owner",now);
  expect(requests).toEqual([{kind:"checkin",key:"scheduled:nudge:2026-09-21",payload:{checkin:"nudge"}}]);
  recent=true;await scheduleCoachJobs("owner",now);expect(requests).toHaveLength(1);
  recent=false;status="completed";await scheduleCoachJobs("owner",now);expect(requests).toHaveLength(1);
 }finally{store.mockRestore();enqueue.mockRestore();list.mockRestore();db.mockRestore();}
});

test("scheduled work waits for an unavailable provider, while chat fails at once",async()=>{
 const finished:unknown[]=[];let next:unknown=null;
 const claim=spyOn(jobs,"claimJob").mockImplementation(async()=>{const job=next;next=null;return job as jobs.ClaimedCoachJob|null;});
 const finish=spyOn(jobs,"finishJob").mockImplementation(async(_user,_id,_token,result)=>{finished.push(result);return true;});
 const checkin=spyOn(service,"generateCheckin").mockRejectedValue(new CoachProviderUnavailableError("A IA está no limite de uso."));
 const chat=spyOn(service,"chatWithCoach").mockRejectedValue(new CoachProviderUnavailableError("A IA está no limite de uso."));
 try{
  next={id:"morning",kind:"checkin",attempts:1,lease_token:"token",payload:{checkin:"morning"}};
  expect(await drainJobs("owner")).toEqual({attempted:1,completed:0,failed:0});
  expect(finished.at(-1)).toEqual({error:"A IA do coach está indisponível agora. Vou tentar de novo automaticamente.",retry:true,delaySeconds:PROVIDER_RETRY_DELAY_SECONDS});
  next={id:"morning",kind:"checkin",attempts:3,lease_token:"token",payload:{checkin:"morning"}};
  expect(await drainJobs("owner")).toEqual({attempted:1,completed:0,failed:1});
  expect(finished.at(-1)).toEqual({error:"A IA do coach continuou indisponível. Seu histórico está preservado; tente novamente.",retry:false});
  next={id:"chat",kind:"chat",attempts:1,lease_token:"token",payload:{message:"Como faço?"}};
  expect(await drainJobs("owner")).toEqual({attempted:1,completed:0,failed:1});
  expect(finished.at(-1)).toMatchObject({retry:false});
  checkin.mockRejectedValue(new Error("unexpected"));
  next={id:"evening",kind:"checkin",attempts:1,lease_token:"token",payload:{checkin:"evening"}};
  expect(await drainJobs("owner")).toEqual({attempted:1,completed:0,failed:1});
  expect(finished.at(-1)).toEqual({error:"O coach não conseguiu concluir. Seu histórico está preservado; tente novamente.",retry:false});
 }finally{claim.mockRestore();finish.mockRestore();checkin.mockRestore();chat.mockRestore();}
});

test("a meeting held after an open agreement and touching its topic queues one follow-up in Ações",async()=>{
 const requests:jobs.JobInput[]=[];let nudges=true;
 const agreement={id:"closer",title:"Amanhã no Pensar Estratégico eu vou destravar a contratação da closer.",status:"open",due_at:null,outcome:null,created_at:"2026-09-22T23:50:00Z",updated_at:"2026-09-22T23:50:00Z"};
 let agreements:unknown[]=[agreement];
 const meetings=[
  {id:"11111111-1111-4111-8111-111111111111",nome:null,original_filename:"online - 20260922 1000.mp3",at:new Date("2026-09-22T13:00:00Z"),summary:null,executive_summary:"Mapeamento de candidatas para a vaga de closer."},
  {id:"22222222-2222-4222-8222-222222222222",nome:null,original_filename:"online - 20260923 1000.mp3",at:new Date("2026-09-23T13:00:00Z"),summary:null,executive_summary:"Planejamento estratégico de marketing para o trimestre."},
  {id:"33333333-3333-4333-8333-333333333333",nome:null,original_filename:"online - 20260923 1400.mp3",at:new Date("2026-09-23T17:00:00Z"),summary:null,executive_summary:"A consultoria enviou a shortlist de closers; entrevistas na sexta."},
  {id:"44444444-4444-4444-8444-444444444444",nome:null,original_filename:"online - 20260923 1500.mp3",at:new Date("2026-09-23T18:00:00Z"),summary:null,executive_summary:null},
 ];
 const store=spyOn(stores,"coachStore").mockReturnValue({profile:async()=>({enabled:true,weekly_enabled:false,nudges_enabled:nudges,revision:1,timezone:"America/Sao_Paulo"}),coverage:async()=>({pending_meetings:0}),recentMeetingReports:async()=>meetings} as unknown as ReturnType<typeof stores.coachStore>);
 const enqueue=spyOn(jobs,"enqueueJob").mockImplementation(async(_user,input)=>{requests.push(input);return {} as jobs.CoachJob;});
 const list=spyOn(commitmentStore,"listCommitments").mockImplementation(async()=>agreements as never);
 let budget:jobs.AttentionBudget={extraToday:false,lastPublished:null,unanswered:0};
 const attention=spyOn(jobs,"attentionBudget").mockImplementation(async()=>budget);
 try{
  const now=new Date("2026-09-23T17:30:00Z");
  await scheduleCoachJobs("owner",now);
  // Before the agreement, unrelated and report-less meetings are skipped.
  expect(requests).toEqual([{kind:"checkin",key:"scheduled:meeting:33333333-3333-4333-8333-333333333333",payload:{checkin:"meeting",meeting_id:"33333333-3333-4333-8333-333333333333"}}]);
  requests.length=0;agreements=[{...agreement,status:"completed"}];await scheduleCoachJobs("owner",now);expect(requests).toEqual([]);
  agreements=[agreement];nudges=false;await scheduleCoachJobs("owner",now);expect(requests).toEqual([]);
  // Attention budget: one optional follow-up per day, spaced, never on top of unanswered check-ins.
  nudges=true;
  for(const blocked of [{extraToday:true,lastPublished:null,unanswered:0},{extraToday:false,lastPublished:new Date("2026-09-23T15:00:00Z"),unanswered:0},{extraToday:false,lastPublished:null,unanswered:2}]){
   budget=blocked;await scheduleCoachJobs("owner",now);expect(requests).toEqual([]);
  }
  budget={extraToday:false,lastPublished:null,unanswered:0};
  await scheduleCoachJobs("owner",new Date("2026-09-23T20:30:00Z"));expect(requests).toEqual([]);
  await scheduleCoachJobs("owner",now);expect(requests).toHaveLength(1);
 }finally{store.mockRestore();enqueue.mockRestore();list.mockRestore();attention.mockRestore();}
});

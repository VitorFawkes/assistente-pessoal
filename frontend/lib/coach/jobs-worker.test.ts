import {expect,spyOn,test} from "bun:test";
import * as stores from "./store";
import * as jobs from "./jobs";
import * as commitmentStore from "./coach-commitments";
import {scheduleCoachJobs} from "./jobs-worker";
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
 const store=spyOn(stores,"coachStore").mockReturnValue({profile:async()=>({enabled:true,weekly_enabled:false,nudges_enabled:true,revision:1,timezone:"America/Sao_Paulo"}),coverage:async()=>({pending_meetings:0})} as unknown as ReturnType<typeof stores.coachStore>);
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

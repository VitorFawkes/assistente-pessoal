import {expect,spyOn,test} from "bun:test";
import * as stores from "./store";
import * as jobs from "./jobs";
import {scheduleCoachJobs} from "./jobs-worker";
test("backfill can advance twice in one cron slot; weekly depends only on its complete period and refreshes for new analyses",async()=>{
 let analyzed=2,newest="2026-09-18T10:00:00.000Z",complete=true;
 const requests:jobs.JobInput[]=[];
 const store=spyOn(stores,"coachStore").mockReturnValue({profile:async()=>({enabled:true,weekly_enabled:true,revision:1,timezone:"America/Sao_Paulo",review_day:5,review_hour:17}),coverage:async()=>({pending_meetings:100,analyzed_chunks:analyzed}),analysesInPeriod:async()=>({complete,analyses:[{created_at:newest}]})} as unknown as ReturnType<typeof stores.coachStore>);
 const enqueue=spyOn(jobs,"enqueueJob").mockImplementation(async(_user,input)=>{requests.push(input);return {} as jobs.CoachJob;});
 try{
  const now=new Date("2026-09-20T12:00:00Z");await scheduleCoachJobs("owner",now);analyzed=4;newest="2026-09-20T10:00:00.000Z";await scheduleCoachJobs("owner",now);
  expect(requests.map(r=>r.kind)).toEqual(["analyze","review","analyze","review"]);
  expect(requests[0].key).not.toBe(requests[2].key);expect(requests[1].key).not.toBe(requests[3].key);
  complete=false;await scheduleCoachJobs("owner",now);expect(requests.at(-1)?.kind).toBe("analyze");expect(requests).toHaveLength(5);
 }finally{store.mockRestore();enqueue.mockRestore();}
});

import {expect,spyOn,test} from "bun:test";
import {POST} from "../../app/api/internal/coach/run/route";
import * as stores from "./store";
import * as jobs from "./jobs";
import * as model from "./model";
import * as service from "./service";

// Execute the real cron route, scheduler and worker. Stub only persistence and
// the paid model boundary; empty users retain their actual unchanged last_run_at.
async function runScheduler(users:string[],busy:string[],defer=false){
 const executed:string[]=[],claimed:string[]=[];
 const oldToken=process.env.COACH_CRON_TOKEN;
 process.env.COACH_CRON_TOKEN="synthetic-scheduler-token-0000000000000000";
 const enabled=spyOn(stores,"enabledUserIds").mockResolvedValue(users);
 const store=spyOn(stores,"coachStore").mockReturnValue({
  profile:async()=>({enabled:true,weekly_enabled:false,last_run_at:null}),
  coverage:async()=>({pending_meetings:0}),
 } as unknown as ReturnType<typeof stores.coachStore>);
 const available=spyOn(model,"coachModelAvailable").mockReturnValue(true);
 const claim=spyOn(jobs,"claimJob").mockImplementation(async userId=>{
  claimed.push(userId);
  return busy.includes(userId)?{id:"job-"+userId,kind:"chat",status:"running",attempts:1,error:null,created_at:"2026-09-20",updated_at:"2026-09-20",payload:{message:"Como priorizar?"},lease_token:"lease",profile_revision:1}:null;
 });
 const finish=spyOn(jobs,"finishJob").mockResolvedValue(true);
 const chat=spyOn(service,"chatWithCoach").mockImplementation(async userId=>{
  executed.push(userId);if(defer)throw new service.CoachBusyError();
 });
 try{
  const response=await POST(new Request("http://localhost/api/internal/coach/run",{method:"POST",headers:{authorization:"Bearer "+process.env.COACH_CRON_TOKEN}}));
  return {status:response.status,body:await response.json(),executed,claimed};
 }finally{
  for(const spy of [enabled,store,available,claim,finish,chat])spy.mockRestore();
  if(oldToken===undefined)delete process.env.COACH_CRON_TOKEN;else process.env.COACH_CRON_TOKEN=oldToken;
 }
}

test("three empty users cannot starve a fourth user's queued work",async()=>{
 const result=await runScheduler(["empty-a","empty-b","empty-c","busy-d"],["busy-d"]);
 expect(result.status).toBe(200);
 expect(result.executed).toEqual(["busy-d"]);
 expect(result.claimed).toEqual(["empty-a","empty-b","empty-c","busy-d"]);
 expect(result.body).toMatchObject({processed:1,completed:1,failed:0,enabled:4});
});

test("claimed jobs still consume the three-worker limit when their service defers",async()=>{
 const users=["busy-a","busy-b","busy-c","busy-d"];
 const result=await runScheduler(users,users,true);
 expect(result.executed).toEqual(["busy-a","busy-b","busy-c"]);
 expect(result.claimed).toEqual(["busy-a","busy-b","busy-c"]);
 expect(result.body).toMatchObject({processed:3,completed:0,failed:0,enabled:4});
});

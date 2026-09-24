import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { enabledUserIds,coachStore } from "@/lib/coach/store";
import { coachModelAvailable } from "@/lib/coach/model";
import { drainJobs,scheduleCoachJobs } from "@/lib/coach/jobs-worker";
export const dynamic="force-dynamic";
export const maxDuration=600;
export async function POST(req:Request){
 const expected=process.env.COACH_CRON_TOKEN||"";const actual=req.headers.get("authorization")?.replace(/^Bearer /,"")||"";
 if(expected.length<32||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:"unauthorized"},{status:401});
 if(!coachModelAvailable())return NextResponse.json({error:"provider_not_configured"},{status:503});
 const enabled=await enabledUserIds();const users=await Promise.all(enabled.map(async id=>({id,lastRun:(await coachStore(id).profile()).last_run_at||""})));
 users.sort((a,b)=>a.lastRun.localeCompare(b.lastRun));
 let processed=0,failed=0,completed=0;const deadline=Date.now()+450000;
 for(const user of users){
  if(Date.now()+240000>deadline||processed>=3)break;
  try{await scheduleCoachJobs(user.id);const result=await drainJobs(user.id,{maxJobs:1,deadline});completed+=result.completed;failed+=result.failed;if(result.attempted>0)processed++;}catch{failed++;}
 }
 const channel=await import("@/lib/whatsapp/channel");
 await channel.refreshChannelState().catch(()=>null);
 for(const user of users){await channel.retryDeliveries(user.id).catch(()=>0);await channel.meetingNotices(user.id).catch(()=>0);}
 let remainingMeetings=0;for(const user of users)remainingMeetings+=(await coachStore(user.id).coverage()).pending_meetings;
 return NextResponse.json({ok:failed===0,processed,completed,failed,remaining_meetings:remainingMeetings,enabled:enabled.length},{status:failed?503:200,headers:{"Cache-Control":"no-store"}});
}

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { coachStore } from "@/lib/coach/store";
import { analyzeMeetings, generateReview, CoachBusyError, CoachPendingError } from "@/lib/coach/service";
export const dynamic="force-dynamic";
export const maxDuration=600;
export async function POST(req:Request){
 const expected=process.env.COACH_CRON_TOKEN||"";const actual=req.headers.get("authorization")?.replace(/^Bearer /,"")||"";
 if(expected.length<32||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:"unauthorized"},{status:401});
 if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"provider_not_configured"},{status:503});
 const users=await query<{id:string}>("SELECT id FROM users WHERE deleted_at IS NULL AND consent_terms_at IS NOT NULL ORDER BY id");
 const enabled: {id:string;lastRun:string|null;weekly:boolean}[]=[];
 for(const user of users){const p=await coachStore(user.id).profile();if(p.enabled)enabled.push({id:user.id,lastRun:p.last_run_at,weekly:p.weekly_enabled});}
 enabled.sort((a,b)=>(a.lastRun||"").localeCompare(b.lastRun||""));
 let processed=0,failed=0,busy=0,pendingReview=0;const deadline=Date.now()+450000;
 for(const user of enabled){
  if(Date.now()+200000>deadline||processed>=3)break;
  try{await analyzeMeetings(user.id,2);if(user.weekly&&Date.now()+100000<deadline)try{await generateReview(user.id,new Date(),false,true);}catch(e){if(e instanceof CoachPendingError)pendingReview++;else throw e;}processed++;}catch(e){if(e instanceof CoachBusyError)busy++;else failed++;}
 }
 let remainingMeetings=0;for(const user of enabled)remainingMeetings+=(await coachStore(user.id).coverage()).pending_meetings;
 return NextResponse.json({ok:failed===0,processed,failed,busy,pending_review:pendingReview,remaining_meetings:remainingMeetings,enabled:enabled.length},{status:failed?503:200,headers:{"Cache-Control":"no-store"}});
}

import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { handleEvent, processInbound } from "@/lib/whatsapp/channel";
export const dynamic="force-dynamic";
export const maxDuration=600;
/** Events from the private coach-whatsapp server. Answers fast; the coach works after the response. */
export async function POST(req:Request){
 const expected=process.env.WHATSAPP_WEBHOOK_SECRET||"";const actual=req.headers.get("x-webhook-secret")||"";
 if(expected.length<32||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:"unauthorized"},{status:401});
 let body:unknown;
 try{const raw=await req.text();if(raw.length>30_000_000)return NextResponse.json({error:"too_large"},{status:413});body=JSON.parse(raw);}catch{return NextResponse.json({error:"invalid"},{status:400});}
 after(async()=>{try{const ticket=await handleEvent(body);if(ticket)await processInbound(ticket);}catch{console.error("whatsapp event failed");}});
 return NextResponse.json({ok:true});
}

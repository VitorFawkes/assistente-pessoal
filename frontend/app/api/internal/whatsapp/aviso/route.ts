import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { sendAviso } from "@/lib/whatsapp/channel";
import { WhatsappUnavailableError } from "@/lib/whatsapp/evolution";
export const dynamic="force-dynamic";
/** System alerts from other Welcome systems (TTARS, n8n) to the owner, through the coach number. */
export async function POST(req:Request){
 const expected=process.env.WHATSAPP_AVISO_TOKEN||"";const actual=req.headers.get("authorization")?.replace(/^Bearer /,"")||"";
 if(expected.length<32||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:"unauthorized"},{status:401});
 if(!rateLimit("whatsapp-aviso",60,3_600_000))return NextResponse.json({error:"rate_limited"},{status:429,headers:{"Retry-After":"300"}});
 let text="";
 try{const body=await req.json();text=typeof body?.text==="string"?body.text.trim():"";}catch{return NextResponse.json({error:"invalid"},{status:400});}
 if(!text||text.length>3000)return NextResponse.json({error:"invalid"},{status:400});
 try{return (await sendAviso(text))?NextResponse.json({ok:true}):NextResponse.json({error:"send_failed"},{status:502});}
 catch(e){return NextResponse.json({error:e instanceof WhatsappUnavailableError?e.message:"unavailable"},{status:503});}
}

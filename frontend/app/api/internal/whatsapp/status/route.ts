import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { channelStatus, refreshChannelState } from "@/lib/whatsapp/channel";
export const dynamic="force-dynamic";
/** Connection probe for the Mac watcher: only the state, never content. */
export async function GET(req:Request){
 const expected=process.env.WHATSAPP_STATUS_TOKEN||"";const actual=req.headers.get("authorization")?.replace(/^Bearer /,"")||"";
 if(expected.length<32||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:"unauthorized"},{status:401});
 await refreshChannelState().catch(()=>null);
 return NextResponse.json(await channelStatus(),{headers:{"Cache-Control":"no-store"}});
}

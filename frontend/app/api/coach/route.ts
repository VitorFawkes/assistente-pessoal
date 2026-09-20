import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { coachStore, type CoachProfilePatch } from "@/lib/coach/store";
import { analyzeMeetings, chatWithCoach, coachState, generateReview, CoachBusyError, CoachPendingError, StaleCoachRunError } from "@/lib/coach/service";
import { CoachAIError } from "@/lib/coach/model";
export const dynamic="force-dynamic";
export const maxDuration=300;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore={"Cache-Control":"private, no-store"};
function string(value:unknown,max:number){if(typeof value!=="string"||value.length>max)throw new Error("invalid_input");return value.trim();}
export const GET=withAuth(async(user)=>NextResponse.json(await coachState(user.id),{headers:noStore}));
export const POST=withAuth(async(user,req)=>{
 const origin=req.headers.get("origin");const host=req.headers.get("x-forwarded-host")||req.headers.get("host");
 if(origin){try{if(new URL(origin).host!==host)throw new Error();}catch{return NextResponse.json({error:"Origem inválida."},{status:403,headers:noStore});}}
 if(!rateLimit(`coach:${user.id}`,30,60_000))return NextResponse.json({error:"Muitas solicitações. Aguarde um minuto."},{status:429,headers:{...noStore,"Retry-After":"60"}});
 try{
  const raw=await req.text();if(raw.length>40000)throw new Error("invalid_input");
  const body=JSON.parse(raw);const store=coachStore(user.id);
  switch(body.action){
   case "settings":{
    const patch:CoachProfilePatch={};
    for(const key of ["enabled","weekly_enabled"] as const)if(body[key]!==undefined){if(typeof body[key]!=="boolean")throw new Error("invalid_input");patch[key]=body[key];}
    for(const key of ["goals","context"] as const)if(body[key]!==undefined)patch[key]=string(body[key],10000);
    if(body.timezone!==undefined){patch.timezone=string(body.timezone,80);new Intl.DateTimeFormat("en-US",{timeZone:patch.timezone}).format();}
    for(const [key,max] of [["review_day",6],["review_hour",23]] as const)if(body[key]!==undefined){if(!Number.isInteger(body[key])||body[key]<0||body[key]>max)throw new Error("invalid_input");patch[key]=body[key];}
    await store.saveProfile(patch);break;
   }
   case "memory":{
    const content=string(body.content,4000);if(!content||!["goal","context","pattern","experiment"].includes(body.kind))throw new Error("invalid_input");
    await store.addMemory({kind:body.kind,content,status:"confirmed",evidence:[]});break;
   }
   case "correct_memory":{
    const content=string(body.content,4000);if(!content||!uuid.test(body.id)||!["confirmed","hypothesis","rejected"].includes(body.status))throw new Error("invalid_input");
    const changed=await store.correctMemory(body.id,content,body.status);if(!changed)return NextResponse.json({error:"Memória não encontrada."},{status:404,headers:noStore});break;
   }
   case "chat":{const message=string(body.message,6000);if(!message)throw new Error("invalid_input");await chatWithCoach(user.id,message);break;}
   case "analyze":await analyzeMeetings(user.id);break;
   case "review":await generateReview(user.id,new Date(),true);break;
   case "delete":if(body.confirm!=="APAGAR COACH")throw new Error("invalid_input");await store.reset();break;
   default:throw new Error("invalid_input");
  }
  return NextResponse.json(await coachState(user.id),{headers:noStore});
 }catch(e){
  if(e instanceof CoachAIError)return NextResponse.json({error:e.message},{status:503,headers:noStore});
  if(e instanceof CoachBusyError||e instanceof CoachPendingError||e instanceof StaleCoachRunError)return NextResponse.json({error:e.message},{status:409,headers:noStore});
  if(e instanceof SyntaxError||e instanceof RangeError||(e instanceof Error&&e.message==="invalid_input"))return NextResponse.json({error:"Revise os campos e tente novamente."},{status:400,headers:noStore});
  if(e instanceof Error&&e.message.startsWith("Ative o coach"))return NextResponse.json({error:e.message},{status:409,headers:noStore});
  // Never log prompts, provider responses, database details or private context.
  console.error("coach request failed");
  return NextResponse.json({error:"Não foi possível salvar esta alteração. Seu histórico está preservado; tente novamente."},{status:500,headers:noStore});
 }
});

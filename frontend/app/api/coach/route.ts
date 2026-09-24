import { after, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { coachStore, GoalLimitError, type CoachProfilePatch } from "@/lib/coach/store";
import { coachState, CoachBusyError, CoachPendingError, StaleCoachRunError } from "@/lib/coach/service";
import { CoachAIError } from "@/lib/coach/model";
import { cancelJobs,clearJobs,enqueueJob,listJobs,retryJob } from "@/lib/coach/jobs";
import { drainJobs } from "@/lib/coach/jobs-worker";
import { coachModelAvailable } from "@/lib/coach/model";
import { calendarContext,calendarStatus,clearCalendarSnapshot,setCalendarEnabled } from "@/lib/coach/calendar";
import { connectChannel,setProactive,startLink,unlink,whatsappAllowed,whatsappView } from "@/lib/whatsapp/channel";
import { WhatsappUnavailableError } from "@/lib/whatsapp/evolution";
export const dynamic="force-dynamic";
export const maxDuration=600;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore={"Cache-Control":"private, no-store"};
function string(value:unknown,max:number){if(typeof value!=="string"||value.length>max)throw new Error("invalid_input");return value.trim();}
async function state(user:{id:string;is_admin:boolean}){const userId=user.id;const [coach,jobs,calendar,whatsapp,goals]=await Promise.all([coachState(userId),listJobs(userId),calendarStatus(userId),whatsappView(user).catch(()=>null),coachStore(userId).goals()]);return {...coach,jobs,calendar,whatsapp,goals};}
function resume(userId:string){after(async()=>{try{await drainJobs(userId,{maxJobs:1,deadline:Date.now()+480000});}catch{console.error("coach worker unavailable");}});}
export const GET=withAuth(async(user)=>NextResponse.json(await state(user),{headers:noStore}));
export const POST=withAuth(async(user,req)=>{
 const origin=req.headers.get("origin");const host=req.headers.get("x-forwarded-host")||req.headers.get("host");
 if(origin){try{if(new URL(origin).host!==host)throw new Error();}catch{return NextResponse.json({error:"Origem inválida."},{status:403,headers:noStore});}}
 if(!rateLimit(`coach:${user.id}`,30,60_000))return NextResponse.json({error:"Muitas solicitações. Aguarde um minuto."},{status:429,headers:{...noStore,"Retry-After":"60"}});
 try{
  const raw=await req.text();if(raw.length>40000)throw new Error("invalid_input");
  const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("invalid_input");const store=coachStore(user.id);
  switch(body.action){
   case "settings":{
    const patch:CoachProfilePatch={};
    for(const key of ["enabled","weekly_enabled","morning_enabled","evening_enabled","nudges_enabled"] as const)if(body[key]!==undefined){if(typeof body[key]!=="boolean")throw new Error("invalid_input");patch[key]=body[key];}
    for(const key of ["goals","context"] as const)if(body[key]!==undefined)patch[key]=string(body[key],10000);
    if(body.timezone!==undefined){patch.timezone=string(body.timezone,80);new Intl.DateTimeFormat("en-US",{timeZone:patch.timezone}).format();}
    for(const [key,max] of [["review_day",6],["review_hour",23],["morning_hour",23],["evening_hour",23]] as const)if(body[key]!==undefined){if(!Number.isInteger(body[key])||body[key]<0||body[key]>max)throw new Error("invalid_input");patch[key]=body[key];}
    await store.saveProfile(patch);if(patch.enabled===false)await clearCalendarSnapshot(user.id);await cancelJobs(user.id);break;
   }
   case "calendar_settings":{
    if(typeof body.enabled!=="boolean")throw new Error("invalid_input");
    await setCalendarEnabled(user.id,body.enabled);await cancelJobs(user.id);break;
   }
   case "calendar_refresh":{
    if(!rateLimit(`coach-calendar:${user.id}`,2,60_000))return NextResponse.json({error:"Aguarde um minuto antes de atualizar a agenda novamente."},{status:429,headers:{...noStore,"Retry-After":"60"}});
    const profile=await store.profile();await calendarContext(user.id,undefined,{force:true,timezone:profile.timezone});break;
   }
   case "memory":{
    const content=string(body.content,4000);if(!content||!["goal","context","pattern","experiment"].includes(body.kind))throw new Error("invalid_input");
    await store.addMemory({kind:body.kind,content,status:"confirmed",evidence:[]});await cancelJobs(user.id);break;
   }
   case "correct_memory":{
    const content=string(body.content,4000);if(!content||!uuid.test(body.id)||!["confirmed","hypothesis","rejected"].includes(body.status))throw new Error("invalid_input");
    const changed=await store.correctMemory(body.id,content,body.status);if(!changed)return NextResponse.json({error:"Memória não encontrada."},{status:404,headers:noStore});await cancelJobs(user.id);break;
   }
   case "chat":case "analyze":case "review":case "checkin":{
    if(!coachModelAvailable())throw new CoachAIError("O modelo escolhido ainda não está configurado. Seu histórico continua disponível.");
    const key=string(body.request_id,160);if(!key)throw new Error("invalid_input");
    await enqueueJob(user.id,{kind:body.action,key:`manual:${key}`,payload:body.action==="chat"?{message:string(body.message,6000)}:body.action==="checkin"?{checkin:body.checkin}:{force:body.action==="review"}});
    resume(user.id);break;
   }
   case "whatsapp_link":{
    if(!whatsappAllowed(user))throw new Error("invalid_input");
    if(!rateLimit(`coach-whatsapp-link:${user.id}`,5,600_000))return NextResponse.json({error:"Muitos códigos em pouco tempo. Aguarde alguns minutos."},{status:429,headers:{...noStore,"Retry-After":"600"}});
    const code=await startLink(user.id);return NextResponse.json({...await state(user),whatsapp_code:code},{headers:noStore});
   }
   case "whatsapp_unlink":if(!whatsappAllowed(user))throw new Error("invalid_input");await unlink(user.id);break;
   case "whatsapp_proactive":if(!whatsappAllowed(user)||typeof body.enabled!=="boolean")throw new Error("invalid_input");await setProactive(user.id,body.enabled);break;
   case "whatsapp_connect":
    if(!whatsappAllowed(user))throw new Error("invalid_input");
    if(!rateLimit(`coach-whatsapp-connect:${user.id}`,6,60_000))return NextResponse.json({error:"Aguarde um minuto antes de gerar outro código."},{status:429,headers:{...noStore,"Retry-After":"60"}});
    await connectChannel();break;
   case "resume_jobs":resume(user.id);break;
   case "cancel_job":if(!uuid.test(body.id))throw new Error("invalid_input");await cancelJobs(user.id,body.id);break;
   case "retry_job":if(!uuid.test(body.id))throw new Error("invalid_input");if(!await retryJob(user.id,body.id))return NextResponse.json({error:"Este pedido não pode ser retomado. Envie uma nova mensagem com seu contexto atual."},{status:409,headers:noStore});resume(user.id);break;
   case "goal_save":{
    const content=string(body.content,500);const area=body.area==="work"||body.area==="life"?body.area:null;
    const due=body.due===null||body.due===undefined||body.due===""?null:string(body.due,10);const measure=body.measure?string(body.measure,500):null;
    if(!content||!area||(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))||(body.id!==undefined&&!uuid.test(body.id)))throw new Error("invalid_input");
    if(!await store.saveGoal({id:body.id,area,content,due,measure:measure||null}))return NextResponse.json({error:"Objetivo não encontrado."},{status:404,headers:noStore});
    await cancelJobs(user.id);break;
   }
   case "goal_status":{
    if(!uuid.test(body.id)||!["active","paused","completed"].includes(body.lifecycle))throw new Error("invalid_input");
    if(!await store.transitionMemory(body.id,{lifecycle:body.lifecycle}))return NextResponse.json({error:"Objetivo não encontrado."},{status:404,headers:noStore});
    await cancelJobs(user.id);break;
   }
   case "memory_lifecycle":{
    if(!uuid.test(body.id)||!["active","paused","completed","superseded"].includes(body.lifecycle))throw new Error("invalid_input");
    const changed=await store.transitionMemory(body.id,{lifecycle:body.lifecycle,replacement:body.replacement===undefined?undefined:{content:string(body.replacement,4000)}},body.revision);
    if(!changed)return NextResponse.json({error:"Memória não encontrada."},{status:404,headers:noStore});await cancelJobs(user.id);break;
   }
   case "delete":if(body.confirm!=="APAGAR COACH")throw new Error("invalid_input");await cancelJobs(user.id);await store.reset();await clearJobs(user.id);break;
   default:throw new Error("invalid_input");
  }
  return NextResponse.json(await state(user),{headers:noStore});
 }catch(e){
  if(e instanceof GoalLimitError||(e instanceof Error&&e.message.startsWith("Já existe um objetivo")))return NextResponse.json({error:e.message},{status:409,headers:noStore});
  if(e instanceof Error&&e.message==="calendar_not_configured")return NextResponse.json({error:"A agenda ainda não está conectada a esta conta."},{status:409,headers:noStore});
  if(e instanceof CoachAIError)return NextResponse.json({error:e.message},{status:503,headers:noStore});
  if(e instanceof WhatsappUnavailableError)return NextResponse.json({error:"O WhatsApp do Coach está indisponível agora. Tente de novo em instantes."},{status:503,headers:noStore});
  if(e instanceof CoachBusyError||e instanceof CoachPendingError||e instanceof StaleCoachRunError)return NextResponse.json({error:e.message},{status:409,headers:noStore});
  if(e instanceof SyntaxError||e instanceof RangeError||(e instanceof Error&&e.message==="invalid_input"))return NextResponse.json({error:"Revise os campos e tente novamente."},{status:400,headers:noStore});
  if(e instanceof Error&&e.message.startsWith("Ative o coach"))return NextResponse.json({error:e.message},{status:409,headers:noStore});
  // Never log prompts, provider responses, database details or private context.
  console.error("coach request failed");
  return NextResponse.json({error:"Não foi possível salvar esta alteração. Seu histórico está preservado; tente novamente."},{status:500,headers:noStore});
 }
});

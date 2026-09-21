import { randomUUID } from "node:crypto";
import { withTenant } from "../db";
import type { CalendarBridgeStatus,CalendarContext,CalendarRange,CalendarSnapshot,CalendarStatus } from "./calendar-types";
export type { CalendarContext,CalendarRange,CalendarSnapshot,CalendarStatus } from "./calendar-types";

const FRESH_MS=15*60_000;
const RETRY_MS=60_000;
const MAX_WINDOW=31*86400_000;
const stamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const validTime=(value:unknown):value is string=>typeof value==="string"&&stamp.test(value)&&Number.isFinite(Date.parse(value));
export type CalendarRow={enabled:boolean;snapshot:CalendarSnapshot|null;error_status:CalendarBridgeStatus|null;attempted_at:string|null;lease_token:string|null;lease_until:string|null};
type CalendarConfig={baseUrl:string;token:string;userId:string};
type CalendarState={row:CalendarRow|null;profileEnabled:boolean;revision:number};
export interface CalendarRepository {
 read(userId:string):Promise<CalendarState>;
 claim(userId:string,range:CalendarRange,token:string):Promise<number|null>;
 save(userId:string,token:string,revision:number,snapshot:CalendarSnapshot|null,error:CalendarBridgeStatus|null):Promise<boolean>;
 setEnabled(userId:string,enabled:boolean):Promise<void>;
 clear(userId:string):Promise<void>;
}
function config():CalendarConfig|null{
 const baseUrl=process.env.COACH_TTARS_CALENDAR_BASE_URL?.replace(/\/+$/,"");
 const token=process.env.COACH_TTARS_CALENDAR_TOKEN;
 const userId=process.env.COACH_TTARS_CALENDAR_USER_ID;
 if(!baseUrl||!token||!userId||!/^[0-9a-f-]{36}$/i.test(userId))return null;
 try{const url=new URL(baseUrl);if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||!url.pathname.endsWith("/functions/v1"))return null;}catch{return null;}
 return {baseUrl,token,userId};
}
export function defaultCalendarRange(now=Date.now(),timezone="America/Sao_Paulo"):CalendarRange{
 let formatter:Intl.DateTimeFormat;
 const dateOptions={year:"numeric",month:"2-digit",day:"2-digit"} as const;
 try{formatter=new Intl.DateTimeFormat("en-CA",{...dateOptions,timeZone:timezone});}
 catch{formatter=new Intl.DateTimeFormat("en-CA",{...dateOptions,timeZone:"America/Sao_Paulo"});}
 const localDate=(time:number)=>{
  const parts=formatter.formatToParts(time);
  return ["year","month","day"].map(type=>parts.find(part=>part.type===type)!.value).join("-");
 };
 const day=Date.parse(`${localDate(now)}T00:00:00Z`);
 const startOfLocalDay=(offset:number)=>{
  const nominal=day+offset*86400_000,target=new Date(nominal).toISOString().slice(0,10);
  // Find the date boundary itself: DST can make local midnight nonexistent or repeated.
  let before=nominal-86400_000,after=nominal+86400_000;
  while(after-before>1){const middle=Math.floor((before+after)/2);if(localDate(middle)<target)before=middle;else after=middle;}
  return new Date(after).toISOString();
 };
 return {from:startOfLocalDay(-1),to:startOfLocalDay(8)};
}
function validRange(range:CalendarRange){
 if(!validTime(range.from)||!validTime(range.to)||Date.parse(range.to)<=Date.parse(range.from)||Date.parse(range.to)-Date.parse(range.from)>MAX_WINDOW)throw new Error("invalid_calendar_range");
}
export function validateCalendarSnapshot(value:unknown,range:CalendarRange,now:number):CalendarSnapshot{
 validRange(range);
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_calendar_response");
 const data=value as Record<string,unknown>;
 if(data.version!==1||!["connected","needs_reconnect","unavailable"].includes(String(data.status))||!validTime(data.from)||!validTime(data.to)||Date.parse(data.from)>Date.parse(range.from)||Date.parse(data.to)<Date.parse(range.to)||Date.parse(data.to)-Date.parse(data.from)>MAX_WINDOW||(data.updated_at===null?data.status==="connected":!validTime(data.updated_at)||Date.parse(data.updated_at)>now+60_000)||!Array.isArray(data.events)||data.events.length>1000||!Array.isArray(data.limitations)||data.limitations.length>20||data.limitations.some(x=>typeof x!=="string"||x.length>500))throw new Error("invalid_calendar_response");
 const ids=new Set<string>();
 const events=data.events.map((raw:unknown)=>{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("invalid_calendar_event");
  const e=raw as Record<string,unknown>;
  if(typeof e.id!=="string"||!e.id||e.id.length>2048||ids.has(e.id)||typeof e.subject!=="string"||e.subject.length>1000||!validTime(e.start)||!validTime(e.end)||Date.parse(e.end)<=Date.parse(e.start)||Date.parse(e.end)<=Date.parse(data.from as string)||Date.parse(e.start)>=Date.parse(data.to as string)||typeof e.is_all_day!=="boolean"||typeof e.is_private!=="boolean"||typeof e.show_as!=="string"||e.show_as.length>30)throw new Error("invalid_calendar_event");
  ids.add(e.id);
  return {id:e.id,subject:e.subject,start:e.start,end:e.end,is_all_day:e.is_all_day,is_private:e.is_private,show_as:e.show_as};
 });
 return {version:1,status:data.status as CalendarBridgeStatus,from:data.from,to:data.to,updated_at:data.updated_at as string|null,events:data.status==="connected"?events:[],limitations:(data.limitations as string[]).map(translateLimitation)};
}
function translateLimitation(value:string):string{
 const known:Record<string,string>={calendar_is_a_plan_not_proof_of_attendance:"Agenda registra planejamento, não comprova presença.",default_microsoft_calendar_only:"Somente o calendário principal da Microsoft. Calendários secundários e eventos apenas locais do Mac não estão incluídos.",microsoft_reconnection_required:"Reconecte sua conta Microsoft no TTARS.",calendar_incomplete:"A Microsoft devolveu uma leitura incompleta; não a use para concluir disponibilidade.",calendar_temporarily_unavailable:"A agenda está temporariamente indisponível.",snapshot_not_found:"Ainda não há uma leitura disponível para este período.",snapshot_stale:"A leitura deste período está desatualizada.",owner_not_authorized:"A conexão com a agenda está indisponível nesta conta."};
 return known[value]??(/^[a-z0-9_]+$/.test(value)?"A agenda informou uma limitação na leitura; confirme os compromissos no Outlook.":value);
}
function statusOf(configured:boolean,state:CalendarState,now:number):CalendarStatus{
 const row=state.row,snapshot=row?.snapshot;
 const status:CalendarStatus["status"]=!configured?"not_configured":!state.profileEnabled||row?.enabled===false?"paused":row?.error_status??(!snapshot?"not_synced":snapshot.status!=="connected"?snapshot.status:!snapshot.updated_at||now-Date.parse(snapshot.updated_at)>FRESH_MS?"stale":"connected");
 const explanations:Partial<Record<CalendarStatus["status"],string>>={not_configured:"Agenda externa ainda não conectada a esta conta.",paused:"Leitura da agenda pausada.",not_synced:"Agenda ainda não consultada. Não é possível concluir que o dia esteja livre.",stale:"A última leitura da agenda está desatualizada. Confirme os horários antes de planejar.",unavailable:"Não foi possível atualizar a agenda. Isso não significa que você esteja sem compromissos.",needs_reconnect:"A conexão com a Microsoft precisa ser renovada no TTARS."};
 return {configured,enabled:configured&&row?.enabled!==false,status,updated_at:snapshot?.updated_at??null,from:snapshot?.from??null,to:snapshot?.to??null,limitations:[...(snapshot?.limitations??[]),...(explanations[status]?[explanations[status]!]:[])]};
}
function contains(snapshot:CalendarSnapshot|null|undefined,range:CalendarRange){return !!snapshot&&Date.parse(snapshot.from)<=Date.parse(range.from)&&Date.parse(snapshot.to)>=Date.parse(range.to);}
function asContext(status:CalendarStatus,snapshot?:CalendarSnapshot|null,range?:CalendarRange,timezone="America/Sao_Paulo"):CalendarContext{
 let formatter:Intl.DateTimeFormat;
 try{formatter=new Intl.DateTimeFormat("pt-BR",{timeZone:timezone,dateStyle:"short",timeStyle:"short"});}catch{timezone="America/Sao_Paulo";formatter=new Intl.DateTimeFormat("pt-BR",{timeZone:timezone,dateStyle:"short",timeStyle:"short"});}
 const events=status.status==="connected"&&(!range||contains(snapshot,range))?(snapshot?.events??[]).filter(e=>!range||(Date.parse(e.end)>Date.parse(range.from)&&Date.parse(e.start)<Date.parse(range.to))).map(e=>({...e,start_local:e.is_all_day?"Dia inteiro; conferir as datas e o fuso do evento no Outlook":formatter.format(new Date(e.start))+` (${timezone})`,end_local:e.is_all_day?"Fim exclusivo do evento de dia inteiro":formatter.format(new Date(e.end))+` (${timezone})`})):[];
 return {...status,events,planned_only:true,limitations:[...status.limitations,"Agenda registra compromissos planejados, não comprova presença, trabalho realizado ou eficácia. Espaços sem eventos não comprovam disponibilidade."]};
}
export function createCalendarAccess(repository:CalendarRepository,deps:{config?:()=>CalendarConfig|null;now?:()=>number;fetch?:(url:string|URL,init?:RequestInit)=>Promise<Response>}={}){
 const settings=deps.config??config,clock=deps.now??Date.now,request=deps.fetch??fetch;
 const unavailable=()=>({row:null,profileEnabled:false,revision:0});
 const access={
  async status(userId:string):Promise<CalendarStatus>{const configured=settings()?.userId===userId;return statusOf(configured,configured?await repository.read(userId):unavailable(),clock());},
  async context(userId:string,range:CalendarRange|undefined=undefined,options:{force?:boolean;timezone?:string}={}):Promise<CalendarContext>{
   const cfg=settings();
   if(!cfg||cfg.userId!==userId)return asContext(statusOf(false,unavailable(),clock()));
   const state=await repository.read(userId);let status=statusOf(true,state,clock());
   if(status.status==="paused")return asContext(status);
   range??=defaultCalendarRange(clock(),options.timezone);
   try{validRange(range);}catch{return asContext({...status,status:"unavailable",limitations:["A agenda pode ser consultada por até 31 dias por vez. Este período maior não foi consultado; use os registros das reuniões e tarefas e deixe esta limitação explícita."]});}
   if(!options.force&&status.status==="connected"&&contains(state.row?.snapshot,range))return asContext(status,state.row?.snapshot,range,options.timezone);
   const leaseBusy=state.row?.lease_until&&Date.parse(state.row.lease_until)>clock();
   const backedOff=!options.force&&state.row?.error_status&&state.row.attempted_at&&clock()-Date.parse(state.row.attempted_at)<RETRY_MS;
   if(leaseBusy||backedOff){if(!contains(state.row?.snapshot,range))status={...status,status:"unavailable",limitations:[...status.limitations,"Leitura deste período ainda indisponível; atualização em andamento ou aguardando nova tentativa."]};return asContext(status,state.row?.snapshot,range,options.timezone);}
   const token=randomUUID();const revision=await repository.claim(userId,range,token);
   if(revision===null)return asContext({...status,status:"unavailable",limitations:[...status.limitations,"Agenda aguardando atualização."]});
   let snapshot:CalendarSnapshot|null=null;let error:CalendarBridgeStatus|null=null;
   try{
    const headers={Authorization:`Bearer ${cfg.token}`,"Content-Type":"application/json"};
    const sync=await request(`${cfg.baseUrl}/coach-calendar-sync`,{method:"POST",headers,body:JSON.stringify(range),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(25_000)});
    if(!sync.ok)throw new Error("calendar_sync_failed");
    const syncRaw=await sync.text();if(syncRaw.length>20_000)throw new Error("calendar_sync_response_too_large");
    const capture=validateCalendarSnapshot({...JSON.parse(syncRaw),events:[]},range,clock());
    if(capture.status!=="connected")snapshot=capture;
    else{
     const url=new URL(`${cfg.baseUrl}/coach-calendar-read`);url.searchParams.set("from",range.from);url.searchParams.set("to",range.to);
     const read=await request(url,{headers,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15_000)});
     if(!read.ok)throw new Error("calendar_read_failed");
     const raw=await read.text();if(raw.length>5_000_000)throw new Error("calendar_response_too_large");
     snapshot=validateCalendarSnapshot(JSON.parse(raw),range,clock());
     if(snapshot.status==="connected"&&Date.parse(snapshot.updated_at!)!==Date.parse(capture.updated_at!))throw new Error("calendar_generation_mismatch");
    }
    if(snapshot.status==="connected"&&(!snapshot.updated_at||clock()-Date.parse(snapshot.updated_at)>FRESH_MS))throw new Error("calendar_response_stale");
    if(snapshot.status!=="connected")error=snapshot.status;
   }catch{snapshot=null;error="unavailable";}
   const saved=await repository.save(userId,token,revision,snapshot,error);
   const latest=await repository.read(userId);
   status=statusOf(true,latest,clock());
   if(!saved)return asContext({...status,status:status.status==="paused"?"paused":"unavailable",limitations:[...status.limitations,"Seu contexto mudou durante a leitura; esta resposta da agenda foi descartada."]});
   return asContext(status,latest.row?.snapshot,range,options.timezone);
  },
  async setEnabled(userId:string,enabled:boolean){if(settings()?.userId!==userId)throw new Error("calendar_not_configured");await repository.setEnabled(userId,enabled);},
  async clear(userId:string){await repository.clear(userId);},
 };
 return access;
}

export const calendarRepository:CalendarRepository={
 read:userId=>withTenant(userId,async db=>{
  const profile=(await db.query<{enabled:boolean;revision:number}>("SELECT enabled,revision FROM coach_profiles WHERE user_id=$1",[userId])).rows[0];
  const row=(await db.query<CalendarRow>("SELECT enabled,snapshot,error_status,attempted_at::text,lease_token::text,lease_until::text FROM coach_calendar_cache WHERE user_id=$1",[userId])).rows[0]??null;
  return {row,profileEnabled:profile?.enabled??false,revision:profile?.revision??0};
 }),
 claim:(userId,_range,token)=>withTenant(userId,async db=>{
  const profile=(await db.query<{revision:number}>("SELECT revision FROM coach_profiles WHERE user_id=$1 AND enabled FOR UPDATE",[userId])).rows[0];
  if(!profile)return null;
  await db.query("INSERT INTO coach_calendar_cache(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[userId]);
  const claimed=await db.query("UPDATE coach_calendar_cache SET lease_token=$2,lease_until=now()+interval '2 minutes',attempted_at=now() WHERE user_id=$1 AND enabled AND (lease_until IS NULL OR lease_until<now()) RETURNING user_id",[userId,token]);
  return claimed.rowCount?profile.revision:null;
 }),
 save:(userId,token,revision,snapshot,error)=>withTenant(userId,async db=>{
  // Same lock order as reset/settings. Revision and lease make erasure and pause win over in-flight HTTP.
  const profile=(await db.query<{revision:number;enabled:boolean}>("SELECT revision,enabled FROM coach_profiles WHERE user_id=$1 FOR UPDATE",[userId])).rows[0];
  if(!profile?.enabled||profile.revision!==revision){await db.query("UPDATE coach_calendar_cache SET lease_token=NULL,lease_until=NULL WHERE user_id=$1 AND lease_token=$2",[userId,token]);return false;}
  const saved=await db.query("UPDATE coach_calendar_cache SET snapshot=$3::jsonb,error_status=$4,lease_token=NULL,lease_until=NULL WHERE user_id=$1 AND enabled AND lease_token=$2",[userId,token,snapshot?JSON.stringify(snapshot):null,error]);
  return !!saved.rowCount;
 }),
 setEnabled:(userId,enabled)=>withTenant(userId,async db=>{
  await db.query("UPDATE coach_profiles SET revision=revision+1,updated_at=now() WHERE user_id=$1",[userId]);
  await db.query("INSERT INTO coach_calendar_cache(user_id,enabled) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,snapshot=NULL,error_status=NULL,lease_token=NULL,lease_until=NULL,attempted_at=NULL",[userId,enabled]);
 }),
 clear:userId=>withTenant(userId,async db=>{await db.query("DELETE FROM coach_calendar_cache WHERE user_id=$1",[userId]);}),
};
const calendar=createCalendarAccess(calendarRepository);
export const calendarStatus=calendar.status;
export const calendarContext=calendar.context;
export const setCalendarEnabled=calendar.setEnabled;
export const clearCalendar=calendar.clear;
/** Keep the user's agenda preference, but remove copied events when the whole coach pauses. */
export async function clearCalendarSnapshot(userId:string){
 await withTenant(userId,db=>db.query("UPDATE coach_calendar_cache SET snapshot=NULL,error_status=NULL,lease_token=NULL,lease_until=NULL,attempted_at=NULL WHERE user_id=$1",[userId]));
}

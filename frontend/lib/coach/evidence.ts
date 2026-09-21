import { createHash } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { COMPETENCIES } from "./framework";
import type { CoachMeeting, Competency, Observation, Evidence } from "./types";
export type MeetingChunk = { index: number; count: number; text: string; source_hash: string; start_offset?: number; end_offset?: number };
export function sourceHash(m: CoachMeeting): string {
 return createHash("sha256").update(JSON.stringify([m.transcription,m.segments,m.speaker_labels,m.speaker_pessoas,m.recorded_at,"evidence-v2"])).digest("hex");
}
export function chunkMeeting(m: CoachMeeting, size=24000): MeetingChunk[] {
 if (!Number.isInteger(size)||size<100) throw new Error("Tamanho de parte inválido");
 const pieces: string[]=[]; let at=0;
 while(at<m.transcription.length){let end=Math.min(at+size,m.transcription.length); if(end<m.transcription.length){const newline=m.transcription.lastIndexOf("\n",end); if(newline>at+size/2) end=newline+1;} pieces.push(m.transcription.slice(at,end)); at=end;}
 const hash=sourceHash(m); let offset=0; return pieces.map((text,index)=>{const start_offset=offset;offset+=text.length;return {index,count:pieces.length,text,source_hash:hash,start_offset,end_offset:offset};});
}
const clean=(v:unknown,max=2000)=>typeof v==="string"?v.trim().slice(0,max):"";
export function groundQuote(quote:unknown,m:CoachMeeting,chunk:MeetingChunk,selfIds:string[]): Evidence|null {
 const q=clean(quote,1000); if(q.length<12||!chunk.text.includes(q))return null;
 const matches=Array.isArray(m.segments)?m.segments.filter(s=>typeof s.text==="string"&&s.text.includes(q)):[];
 const turn=matches.length===1?matches[0]:null;
 const person=turn?m.speaker_pessoas?.[turn.speaker]:null;
 return {meeting_id:m.id,meeting_title:m.nome||m.original_filename,recorded_at:m.recorded_at,quote:q,start:turn&&Number.isFinite(turn.start)?turn.start:null,speaker:turn?(m.speaker_labels?.[turn.speaker]||`Participante ${turn.speaker}`):null,self_attributed:!!person&&selfIds.includes(person),chunk_index:chunk.index,source_hash:chunk.source_hash};
}
export function validateObservations(raw:unknown,m:CoachMeeting,chunk:MeetingChunk,selfIds:string[]):Observation[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(0,8).flatMap(item=>{
  if(!item||typeof item!=="object"||!(item.competency in COMPETENCIES)) return [];
  const evidence=(Array.isArray(item.evidence)?item.evidence:[]).slice(0,4).map((e:{quote?:unknown})=>groundQuote(e?.quote,m,chunk,selfIds)).filter((e:Evidence|null):e is Evidence=>!!e);
  const observation=clean(item.observation); if(!observation||!evidence.length)return [];
  return [{competency:item.competency as Competency,observation,hypothesis:clean(item.hypothesis),alternative:clean(item.alternative),experiment:clean(item.experiment),evidence}];
 });
}
/** Most recent scheduled local boundary; stable key covers the preceding 7 days. */
export function reviewPeriod(now:Date,timezone:string,day:number,hour:number){
 const p=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(now);
 const part=(type:string)=>p.find(v=>v.type===type)?.value||"";
 const local=new Date(`${part("year")}-${part("month")}-${part("day")}T12:00:00Z`);
 let days=(local.getUTCDay()-day+7)%7; if(days===0&&Number(part("hour"))<hour) days=7;
 local.setUTCDate(local.getUTCDate()-days);
 const endDay=local.toISOString().slice(0,10);local.setUTCDate(local.getUTCDate()-7);
 const weekStart=local.toISOString().slice(0,10);
 return {weekStart,from:fromZonedTime(`${weekStart}T${String(hour).padStart(2,"0")}:00:00`,timezone).toISOString(),to:fromZonedTime(`${endDay}T${String(hour).padStart(2,"0")}:00:00`,timezone).toISOString()};
}

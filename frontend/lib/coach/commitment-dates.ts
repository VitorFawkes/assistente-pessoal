const normalized=(text:string)=>text.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
const WEEKDAYS=["domingo","segunda","terca","quarta","quinta","sexta","sabado"];
const SHORT_WEEKDAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
type LocalTime={year:number;month:number;day:number;weekday:number;hour:number;minute:number};

function localTime(instant:Date,timezone:string):LocalTime{
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"numeric",day:"numeric",weekday:"short",hour:"numeric",minute:"numeric",hourCycle:"h23"}).formatToParts(instant).map(part=>[part.type,part.value]));
 return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),weekday:SHORT_WEEKDAYS.indexOf(parts.weekday),hour:Number(parts.hour),minute:Number(parts.minute)};
}
/** UTC instant for a wall-clock time; the second pass absorbs a DST offset change. */
function zonedInstant(year:number,month:number,day:number,hour:number,minute:number,timezone:string):Date{
 const wall=Date.UTC(year,month-1,day,hour,minute);let guess=wall;
 for(let pass=0;pass<2;pass++){const seen=localTime(new Date(guess),timezone);guess+=wall-Date.UTC(seen.year,seen.month-1,seen.day,seen.hour,seen.minute);}
 return new Date(guess);
}

/** Day offsets (from the reference's local day) named in the text. */
function dayOffsets(s:string,now:LocalTime):Set<number>{
 const today=Date.UTC(now.year,now.month-1,now.day);
 const offsetOf=(year:number,month:number,day:number)=>{
  const target=new Date(Date.UTC(year,month-1,day));
  return target.getUTCMonth()===month-1&&target.getUTCDate()===day?Math.round((target.getTime()-today)/86400000):null;
 };
 const offsets=new Set<number>();
 if(/\bdepois de amanha\b/u.test(s))offsets.add(2);
 if(/(?<!depois de )\bamanha\b/u.test(s))offsets.add(1);
 if(/\bhoje\b|\b(?:fim|final) do dia\b/u.test(s))offsets.add(0);
 if(/\b(?:fim|final) da semana\b/u.test(s))offsets.add((5-now.weekday+7)%7);
 // Weekday names double as ordinals ("a segunda parte"): require a date-like context.
 for(const match of s.matchAll(/(?:^|\b(?:na|no|ate a|ate|nesta|neste|nessa|nesse|esta|essa|proxima|proximo|ou|e)\s+)(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:[- ]feira)?\b|\b(segunda|terca|quarta|quinta|sexta)[- ]feira\b/gu)){
  offsets.add((WEEKDAYS.indexOf(match[1]||match[2])-now.weekday+7)%7||7);
 }
 for(const match of s.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/gu)){
  const day=Number(match[1]),month=Number(match[2]);
  const year=match[3]?Number(match[3].length===2?"20"+match[3]:match[3]):now.year;
  let offset=offsetOf(year,month,day);
  if(offset!==null&&offset<0&&!match[3])offset=offsetOf(year+1,month,day);
  if(offset!==null)offsets.add(offset);
 }
 for(const match of s.matchAll(/\bdia (\d{1,2})\b/gu)){
  const day=Number(match[1]);let offset=offsetOf(now.year,now.month,day);
  if(offset===null||offset<0)offset=offsetOf(now.month===12?now.year+1:now.year,now.month===12?1:now.month+1,day);
  if(offset!==null)offsets.add(offset);
 }
 return offsets;
}

/**
 * Deadline the user spoke in their own sentence: hoje, amanhã, depois de amanhã,
 * a weekday, fim da semana, dd/mm or "dia N", optionally "às 10h"/"até as 15h".
 * A day without time ends at 23:59 local. Absent, past or ambiguous dates return null.
 */
export function naturalCommitmentDue(text:string,reference:Date,timezone:string):string|null{
 if(!Number.isFinite(reference.getTime()))return null;
 const now=localTime(reference,timezone),s=normalized(text);
 // "Hoje não deu, amanhã vou…": the part after the last comma names the new step.
 let offsets=dayOffsets(s,now);
 if(offsets.size>1)offsets=dayOffsets(s.slice(s.lastIndexOf(",")+1),now);
 const clock=s.match(/(?:^|\s)(?:as|ate as|ate|antes das|antes de|por volta das)\s+(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?![\d/])/u);
 const hour=clock?Number(clock[1]):23,minute=clock?Number(clock[2]??clock[3]??0):59;
 if(hour>23||minute>59||offsets.size>1||(!offsets.size&&!clock))return null;
 const offset=offsets.size?[...offsets][0]:0;
 if(offset<0)return null;
 const day=new Date(Date.UTC(now.year,now.month-1,now.day)+offset*86400000);
 const due=zonedInstant(day.getUTCFullYear(),day.getUTCMonth()+1,day.getUTCDate(),hour,minute,timezone);
 return due.getTime()>reference.getTime()?due.toISOString():null;
}

/** "quarta, 23/09" or "quarta, 23/09 às 8h30" in the user's timezone. */
export function formatCommitmentDue(iso:string,timezone:string):string{
 const instant=new Date(iso),local=localTime(instant,timezone);
 const weekday=new Intl.DateTimeFormat("pt-BR",{timeZone:timezone,weekday:"long"}).format(instant).replace(/-feira$/u,"");
 const date=`${String(local.day).padStart(2,"0")}/${String(local.month).padStart(2,"0")}`;
 const time=local.hour===23&&local.minute===59?"":` às ${local.hour}h${local.minute?String(local.minute).padStart(2,"0"):""}`;
 return `${weekday}, ${date}${time}`;
}

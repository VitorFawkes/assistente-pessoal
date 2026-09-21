import type { CoachMemory, Evidence } from "./types";

/** A past view contains only versions already known at that time. */
export function memoriesAt(memories:CoachMemory[],at:string):CoachMemory[]{
 const time=Date.parse(at);if(!Number.isFinite(time))throw new Error("invalid_input");
 return memories.flatMap<CoachMemory>(memory=>{
  if(Date.parse(memory.created_at)>time)return [];
  const currentFrom=memory.valid_from||memory.created_at;
  const ordered=[...memory.history].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const versions=ordered.map((version,index)=>({...version,valid_from:version.valid_from||(index?ordered[index-1].at:memory.created_at)}))
    .filter(version=>Date.parse(version.at)>time&&Date.parse(version.valid_from)<=time);
  const previous=versions[0];
  if(previous)return [{...memory,...previous,lifecycle:previous.lifecycle||"active",origin:previous.origin||"legacy",supersedes_id:previous.supersedes_id||null,status:previous.status as CoachMemory["status"],evidence:previous.evidence||[],history:[],updated_at:previous.valid_from!,valid_until:previous.valid_until||previous.at}];
  if(Date.parse(currentFrom)>time)return [];
  return [{...memory,history:memory.history.filter(version=>Date.parse(version.at)<=time)}];
 });
}

/** Goals and corrections are mandatory context, not competitors for the recency budget. */
export function memoryContext(memories:CoachMemory[],legacyGoals:string,at?:string){
 const entries=at?memoriesAt(memories,at):memories;
 const time=at?Date.parse(at):Date.now();
 const usable=entries.filter(memory=>!memory.stale||memory.status==="rejected");
 const active_goals=usable.filter(memory=>memory.kind==="goal"&&memory.status==="confirmed"&&(memory.lifecycle||"active")==="active"&&(!memory.valid_until||Date.parse(memory.valid_until)>time));
 const corrections=usable.filter(memory=>memory.status==="rejected"||memory.history.some(version=>version.content!==memory.content||version.status!==memory.status));
 return {active_goals,corrections,memories:usable.filter(memory=>!active_goals.includes(memory)&&!corrections.includes(memory)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).slice(0,100),
  legacy_goals:active_goals.length||at?null:(legacyGoals.trim()?{content:legacyGoals,origin:"legacy_profile",limitations:"Contexto legado: não substitui objetivos temporais encerrados ou pausados."}:null)};
}

const normalize=(value:string)=>value.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
/** Match the corrected passage, not every unrelated statement in its meeting. */
export function sameEvidencePassage(left:Evidence,right:Evidence):boolean{
 if(left.meeting_id!==right.meeting_id||(left.source_hash&&right.source_hash&&left.source_hash!==right.source_hash))return false;
 const a=normalize(left.quote||""),b=normalize(right.quote||"");
 if(!a||!b)return false;
 if(a.includes(b)||b.includes(a))return true;
 // A partial citation may overlap without containing the other complete citation.
 const words=a.split(" ");
 for(let index=0;index+4<=words.length;index++){
  const phrase=words.slice(index,index+4).join(" ");
  if(phrase.length>=16&&(" "+b+" ").includes(" "+phrase+" "))return true;
 }
 return false;
}
/** Corrections veto overlapping evidence or equivalent old interpretations, including paraphrases. */
export function inferenceBlocked(input:{kind:string;content:string;evidence:Evidence[]},memories:CoachMemory[]):boolean{
 if(!["pattern","experiment"].includes(input.kind))return false;
 const candidate=normalize(input.content);
 return memories.some(memory=>{
  const invalidated=memory.history.filter(version=>version.status==="rejected"||version.content!==memory.content);
  const texts=[...(memory.status==="rejected"?[memory.content]:[]),...invalidated.map(version=>version.content)];
  const sources=[...(memory.status==="rejected"?memory.evidence:[]),...invalidated.flatMap(version=>version.evidence||[])];
  return sources.some(source=>input.evidence.some(candidate=>sameEvidencePassage(source,candidate)))||texts.some(content=>{
   const old=normalize(content);if(candidate===old)return true;
   const words=new Set(old.split(" ").filter(word=>word.length>3));
   const other=new Set(candidate.split(" ").filter(word=>word.length>3));
   const common=[...words].filter(word=>other.has(word)).length;
   return words.size>=3&&other.size>=3&&common/Math.max(words.size,other.size)>=0.7;
  });
 });
}

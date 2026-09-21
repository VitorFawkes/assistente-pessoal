import { chunkMeeting, groundQuote, type MeetingChunk } from "./evidence";
import { contextSearchTerms } from "./context-selection";
import type { CoachMeeting, CoachMessage, CoachMemory, Evidence } from "./types";
export type SelectedChunk={meeting:CoachMeeting;chunk:MeetingChunk;score?:number};
/** Intersect a located speaker turn with the requested span, including long turns. */
export function chunkTurns(meeting:CoachMeeting,chunk:MeetingChunk,self:string[]){
 const start=chunk.start_offset??chunkMeeting(meeting).slice(0,chunk.index).reduce((n,c)=>n+c.text.length,0);
 const end=start+chunk.text.length;
 let cursor=0;
 return (meeting.segments||[]).flatMap(s=>{
  if(typeof s.text!=="string"||!s.text)return [];
  const at=meeting.transcription.indexOf(s.text,cursor);
  if(at<0)return [];
  cursor=at+s.text.length;
  const lo=Math.max(at,start),hi=Math.min(cursor,end);
  if(lo>=hi)return [];
  const fragment=meeting.transcription.slice(lo,hi);
  return [{speaker:meeting.speaker_labels?.[s.speaker]||s.speaker,self:self.includes(meeting.speaker_pessoas?.[s.speaker]||""),start:s.start,text:fragment}];
 });
}
export function buildSourceBank(selected:SelectedChunk[],self:string[]){
 const all:Evidence[]=[];
 for(const {meeting,chunk} of selected){
  const found=chunkTurns(meeting,chunk,self).filter(t=>t.self).flatMap(t=>
   (t.text.match(/[^.!?\n]+[.!?]?/g)||[t.text]).flatMap(sentence=>{
    const pieces:string[]=[];for(let at=0;at<sentence.length;at+=850)pieces.push(sentence.slice(at,at+850));
    return pieces.map(q=>groundQuote(q.trim(),meeting,chunk,self)).filter((e):e is Evidence=>!!e&&e.self_attributed);
   }));
  // Spread sources across the whole span; focused reads can reveal every omitted quote.
  const unique=[...new Map(found.map(e=>[e.quote,e])).values()];
  const selectedQuotes=unique.length<=160?unique:Array.from({length:160},(_,i)=>unique[Math.floor(i*(unique.length-1)/159)]);
  all.push(...selectedQuotes);
 }
 return Object.fromEntries(all.map((e,i)=>["e"+i,e]));
}
export function selectChunks(meetings:CoachMeeting[],question:string,limit=6):SelectedChunk[]{
 const terms=contextSearchTerms(question).toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean);
 const ranked=meetings.flatMap(meeting=>chunkMeeting(meeting).map(chunk=>({meeting,chunk,score:terms.reduce((n,w)=>n+(chunk.text.toLocaleLowerCase("pt-BR").includes(w)?1:0),0)})))
  .sort((a,b)=>b.score-a.score);
 const selected:SelectedChunk[]=[];const seen=new Set<string>();
 for(const candidate of ranked){if(!seen.has(candidate.meeting.id)){selected.push(candidate);seen.add(candidate.meeting.id);}if(selected.length>=limit)break;}
 for(const candidate of ranked){if(selected.length>=limit)break;if(!selected.includes(candidate))selected.push(candidate);}
 return selected;
}
export function conversationSearch(question:string,history:CoachMessage[]){
 const followup=/^(por qu[eê]|como assim|explique|explique melhor|e agora|o que faço|por onde começo|isso|e isso|sim|continue|pode aprofundar)[?!.\s]*$/iu.test(question.trim());
 if(!followup)return question;
 const previous=history.filter(m=>m.role==="user"&&!m.stale).slice(-2).map(m=>m.content).join("\n");
 return previous?previous+"\nPergunta atual: "+question:question;
}
export function needsDeepInvestigation(message:string){
 return /prioriz|maior problema|ponto cego|padr[aã]o|decid|decis[aã]o|compar|evolu|contradi|bronca|deleg|aprofund|estrat[eé]g|semana|m[eê]s/iu.test(message);
}
export function memorySafetyContext(memories:CoachMemory[]){
 const restrictions=memories.filter(m=>m.status==="rejected"||m.history.length>0);
 const goals=memories.filter(m=>m.kind==="goal"&&(!m.lifecycle||m.lifecycle==="active")&&m.status==="confirmed"&&!m.stale);
 const other=memories.filter(m=>!restrictions.includes(m)&&!goals.includes(m)&&!m.stale).slice(0,100);
 return [...restrictions,...goals,...other];
}

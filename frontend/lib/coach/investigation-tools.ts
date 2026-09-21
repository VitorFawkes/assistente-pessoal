import { buildMeetingReports, meetingReport, reportContextHash } from "./meeting-reports";
import { coachStore } from "./store";
import { chunkMeeting, sourceHash, type MeetingChunk } from "./evidence";
import { buildSourceBank, selectChunks, chunkTurns, type SelectedChunk } from "./investigation";
import { semanticSearch } from "./retrieval";
import type { CoachReadTool } from "./model";
import type { CoachMeeting, Evidence, ReportSource } from "./types";
const object=(properties:Record<string,unknown>)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function investigationTools(userId:string,timezone:string,now:Date,self:string[],initial:SelectedChunk[]){
 const store=coachStore(userId);
 const selected=[...initial];const meetings=new Map(initial.map(({meeting})=>[meeting.id,meeting]));
 const sources:Record<string,Evidence>=buildSourceBank(initial,self);
 const reportReads:Record<string,unknown>[]=[];
 const contextSources:ReportSource[]=[];
 const track=(meeting:CoachMeeting)=>{
  meetings.set(meeting.id,meeting);
  const context_hash=reportContextHash(meeting);
  if(!contextSources.some(source=>source.meeting_id===meeting.id&&source.context_hash===context_hash))contextSources.push({meeting_id:meeting.id,context_hash});
 };
 let reads=0;
 const append=(meeting:CoachMeeting,chunk:MeetingChunk)=>{
  track(meeting);
  if(!selected.some(s=>s.meeting.id===meeting.id&&s.chunk.index===chunk.index&&s.chunk.start_offset===chunk.start_offset&&s.chunk.text===chunk.text))selected.push({meeting,chunk});
  const added:Record<string,Evidence>={};
  for(const evidence of Object.values(buildSourceBank([{meeting,chunk}],self))){
   const prior=Object.entries(sources).find(([,e])=>e.meeting_id===evidence.meeting_id&&e.chunk_index===evidence.chunk_index&&e.quote===evidence.quote&&e.source_hash===evidence.source_hash);
   const id=prior?.[0]||"e"+Object.keys(sources).length;sources[id]=evidence;added[id]=evidence;
  }
  reads++;
  return {meeting_id:meeting.id,title:meeting.nome||meeting.original_filename,recorded_at:meeting.recorded_at,chunk_index:chunk.index,chunk_count:chunk.count,start_offset:chunk.start_offset,text:chunk.text,sources:added,labeled_turns:chunkTurns(meeting,chunk,self),limitations:["Trecho parcial; use open_meeting para ler a vizinhança. Uma fala não comprova execução."]};
 };
 const tools:CoachReadTool[]=[
 {name:"read_meeting_report",description:"Lê o relatório/resumo gerado no Ações sem reler a transcrição. Contexto secundário, nunca citação original nem prova de comportamento. offset avança até 12000 caracteres por leitura.",parameters:object({meeting_id:{type:"string"},offset:{type:"integer",minimum:0,maximum:1000000}}),execute:async(args)=>{
  const id=String(args.meeting_id);if(!uuid.test(id))return {error:"Reunião não encontrada."};
  const meeting=await store.meetingById(id);if(!meeting)return {error:"Reunião não encontrada."};
  track(meeting);
  const report=meetingReport(meeting),offset=Number(args.offset);
  const result={meeting_id:meeting.id,kind:report.kind,generated:true,behavioral_evidence:false,context_hash:reportContextHash(meeting),text:report.text?.slice(offset,offset+12000)||null,total_characters:report.text?.length||0,offset,has_more:!!report.text&&report.text.length>offset+12000};
  reportReads.push(result);return result;
 }},
 {name:"search_history",description:"Busca reuniões e análises no histórico autorizado, por assunto e período; use também para procurar contraexemplos. Informe from e to juntos com datas ISO (início inclusivo, fim exclusivo), ou ambos vazios para buscar todo o histórico. Não informe apenas um limite.",parameters:object({query:{type:"string",minLength:1,maxLength:500},from:{type:"string",maxLength:40},to:{type:"string",maxLength:40}}),execute:async(args,{signal})=>{
  const query=String(args.query);const from=String(args.from),to=String(args.to);
  if(!!from!==!!to || (from&&(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>=Date.parse(to))))
   return {error:"invalid_period",message:"Informe from e to juntos como datas ISO válidas, com início anterior ao fim, ou ambos vazios.",limitations:["Esta busca não foi executada; não interprete o erro como ausência de reuniões. As fontes já abertas continuam disponíveis."]};
  const context=await store.context(query,{timezone,now,...(from?{period:{from,to}}:{})});
  let semantic:Awaited<ReturnType<typeof semanticSearch>>;
  try{semantic=await semanticSearch(userId,query,signal);}catch{semantic={available:false,matches:[],limitations:["Busca semântica indisponível nesta consulta; busca textual executada."]};}
  const found=[...context.meetings];
  for(const match of semantic.matches.slice(0,6)){
   if(found.some(m=>m.id===match.meeting_id))continue;
   const meeting=await store.meetingById(match.meeting_id);
   if(!meeting||sourceHash(meeting)!==match.source_hash)continue;
   const date=meeting.recorded_at||meeting.context_at;
   const period=context.selection?.period;
   if(period&&(!date||new Date(date)<new Date(period.from)||new Date(date)>=new Date(period.to)))continue;
   found.push(meeting);
  }
  found.forEach(track);
  const reports=buildMeetingReports(found,20000);reportReads.push(...reports.meetings);
  return {meeting_reports:reports.meetings,meetings:found.map(m=>({id:m.id,title:m.nome||m.original_filename,recorded_at:m.recorded_at,chunks:chunkMeeting(m).length})),excerpts:selectChunks(found,query,2).map(({meeting,chunk})=>append(meeting,{...chunk,text:chunk.text.slice(0,6000)})),limitations:[...context.limitations,...semantic.limitations]};
 }},
 {name:"open_meeting",description:"Lê uma parte original da reunião e suas falas atribuídas, com citações verificáveis. chunk_index e offset são zero-based; offset avança dentro da parte, até 6000 caracteres por leitura.",parameters:object({meeting_id:{type:"string"},chunk_index:{type:"integer",minimum:0,maximum:10000},offset:{type:"integer",minimum:0,maximum:24000}}),execute:async(args)=>{
  const id=String(args.meeting_id);if(!uuid.test(id))return {error:"Reunião não encontrada."};
  const meeting=await store.meetingById(id);if(!meeting)return {error:"Reunião não encontrada."};
  const chunk=chunkMeeting(meeting)[Number(args.chunk_index)];if(!chunk)return {error:"Parte não encontrada."};
  const offset=Number(args.offset);return append(meeting,{...chunk,start_offset:(chunk.start_offset||0)+offset,text:chunk.text.slice(offset,offset+6000)});
 }},
 {name:"read_memory",description:"Consulta objetivos vigentes, correções e memória. Use at vazio para estado atual ou uma data ISO para o estado conhecido na época.",parameters:object({at:{type:"string",maxLength:40}}),execute:async(args)=>store.memoryContext(String(args.at)||undefined)},
 {name:"read_tasks",description:"Consulta compromissos e estado das tarefas por assunto, incluindo contagem global e eventos. Alteração de registro não prova execução.",parameters:object({query:{type:"string",maxLength:500}}),execute:async(args)=>{
  const c=await store.context(String(args.query),{timezone,now});return {tasks:c.tasks,events:c.events,summary:c.task_summary,selection:c.task_selection,limitations:c.limitations.filter(l=>/tarefa|registro|execuç/.test(l))};
 }},
 ];
 return {tools,sources,selected,meetings,reportReads,contextSources,reads:()=>reads};
}

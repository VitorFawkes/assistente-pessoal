import { coachStore, StaleCoachRunError } from "./store";
import { chunkMeeting, reviewPeriod, sourceHash, validateObservations, groundQuote, type MeetingChunk } from "./evidence";
import { analysisSchemaWithSources, coachCompletion, coachModel, conversationSchemaWithSources, reviewSchemaWithSources, CoachAIError } from "./model";
import { presentChat } from "./chat-presentation";
import type { CoachMeeting, CoachProfile, CoachState, Evidence, Observation, ReviewContent } from "./types";

export class CoachBusyError extends Error { constructor(){super("O coach está trabalhando no seu histórico. Aguarde um pouco e tente novamente.");} }
export class CoachPendingError extends Error { constructor(){super("As reuniões desta semana ainda têm trechos pendentes. Continue a análise para preparar uma revisão fundamentada.");} }
const text=(v:unknown,max=6000)=>typeof v==="string"?v.trim().slice(0,max):"";
export async function coachState(userId:string):Promise<CoachState>{
 const store=coachStore(userId);
 const [profile,memories,messages,reviews,coverage]=await Promise.all([store.profile(),store.memories(),store.messages(),store.reviews(),store.coverage()]);
 return {profile,memories,messages,reviews,coverage,model_available:!!process.env.OPENAI_API_KEY};
}
async function withLease<T>(userId:string,fn:(store:ReturnType<typeof coachStore>,profile:CoachProfile)=>Promise<T>):Promise<T>{
 const store=coachStore(userId);const profile=await store.profile();
 if(!profile.enabled)throw new Error("Ative o coach para analisar reuniões e conversar.");
 const token=await store.claimLease();if(!token)throw new CoachBusyError();
 let error:string|undefined;
 try{return await fn(store,profile);}catch(e){if(!(e instanceof CoachPendingError))error=e instanceof Error?e.message:"Não foi possível concluir a análise.";throw e;}finally{await store.releaseLease(error,token);}
}
/** Pick query-matching parts without pretending that selected snippets cover the whole archive. */
function contextChunks(meetings:CoachMeeting[],question:string){
 const words=question.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}]{4,}/gu)||[];
 return meetings.flatMap(meeting=>chunkMeeting(meeting).map(chunk=>({meeting,chunk,score:words.reduce((n,w)=>n+(chunk.text.toLocaleLowerCase("pt-BR").includes(w)?1:0),0)})))
 .sort((a,b)=>b.score-a.score).slice(0,6);
}
function labeledTurns(meeting:CoachMeeting,text:string,self:string[]){
 return (Array.isArray(meeting.segments)?meeting.segments:[]).filter(s=>typeof s.text==="string"&&text.includes(s.text)).map(s=>({speaker:meeting.speaker_labels?.[s.speaker]||s.speaker,self:!!meeting.speaker_pessoas?.[s.speaker]&&self.includes(meeting.speaker_pessoas[s.speaker]),start:s.start,text:s.text}));
}
function sourceReferences(raw:unknown,sources:Record<string,Evidence>){
 if(!Array.isArray(raw))return [];
 return raw.map(o=>{
  if(!Array.isArray(o.evidence_ids)||o.evidence_ids.some((id:unknown)=>typeof id!=="string"||!sources[id]))throw new CoachAIError("Uma fonte da resposta não foi confirmada. Tente novamente.");
  return {...o,evidence:o.evidence_ids.map((id:string)=>sources[id])};
 });
}
function sourceBank(selected:{meeting:CoachMeeting;chunk:MeetingChunk}[],self:string[]){
 const excerpts=selected.flatMap(({meeting,chunk})=>labeledTurns(meeting,chunk.text,self).filter(t=>t.self).flatMap(t=>(t.text.match(/[^.!?\n]+[.!?]?/g)||[t.text]).map(quote=>groundQuote(quote.trim(),meeting,chunk,self)).filter((e):e is Evidence=>!!e&&e.self_attributed)).slice(0,100));
 return Object.fromEntries(excerpts.slice(0,300).map((e,i)=>[`e${i}`,e]));
}
export function grounded(raw:unknown,meetings:CoachMeeting[],self:string[]):Observation[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(0,8).flatMap(item=>{
  if(!item||!Array.isArray(item.evidence)||item.evidence.length>4)return [];
  const evidence:Evidence[]=[];
  for(const ref of item.evidence.slice(0,4)){
   const meeting=meetings.find(m=>m.id===ref?.meeting_id);if(!meeting||!Number.isInteger(ref.chunk_index))continue;
   const chunk=chunkMeeting(meeting)[ref.chunk_index];if(!chunk)continue;
   const validated=validateObservations([{...item,evidence:[ref]}],meeting,chunk,self);if(validated[0])evidence.push(...validated[0].evidence);
  }
  return evidence.length&&evidence.length===item.evidence.length&&evidence.some(e=>e.self_attributed)?[{competency:item.competency,observation:text(item.observation,2000),hypothesis:text(item.hypothesis,2000),alternative:text(item.alternative,2000),experiment:text(item.experiment,2000),evidence}]:[];
 });
}
function usableMemories(memories:Awaited<ReturnType<ReturnType<typeof coachStore>["memories"]>>){
 return memories.filter(m=>!m.stale||m.status==="rejected").slice(0,100).map(m=>({kind:m.kind,content:m.content,status:m.status,corrections:m.history.slice(-3),evidence:m.evidence}));
}

export async function analyzeMeetings(userId:string,maxChunks=2){
 return withLease(userId,async(store,profile)=>{
  const [self,memories]=await Promise.all([store.selfPersonIds(),store.memories()]);let processed=0;
  for(let offset=0;processed<maxChunks;offset+=20){
   const meetings=await store.meetingPage(20,offset);if(!meetings.length)break;
   for(const meeting of meetings){
    const existing=await store.analyses(meeting.id);
    const hash=sourceHash(meeting);const done=new Set(existing.filter(a=>a.source_hash===hash).map(a=>a.chunk_index));
    for(const chunk of chunkMeeting(meeting)){
     if(done.has(chunk.index))continue;
     const sources=sourceBank([{meeting,chunk}],self);
     const result=await coachCompletion("Analise somente esta parte da reunião. Retorne no máximo 4 observações de liderança, com hipótese e contraprova. Cada observação seleciona de 1 a 4 evidence_ids existentes no dicionário sources; o servidor mantém os trechos literais. Não reescreva nem invente citações/IDs. Resumo máximo 600 caracteres. Nenhuma observação é obrigatória. Em observations, inclua APENAS conduta sustentada por sources, todas falas confirmadas do próprio usuário. Se não houver, observations=[] e resumo descritivo da reunião sem atribuir comportamento ao usuário. Não deduza autoria pelo nome em um texto.",
      {profile,memories:usableMemories(memories),self_person_ids:self,meeting:{id:meeting.id,title:meeting.nome||meeting.original_filename,recorded_at:meeting.recorded_at,speaker_labels:meeting.speaker_labels,speaker_pessoas:meeting.speaker_pessoas},chunk,sources,labeled_turns:labeledTurns(meeting,chunk.text,self)},analysisSchemaWithSources(Object.keys(sources)));
     const raw=sourceReferences(result.observations,sources);
     const observations=grounded(raw,[meeting],self);
     await store.saveAnalysis({meeting_id:meeting.id,source_hash:hash,chunk_index:chunk.index,chunk_count:chunk.count,observations,summary:text(result.summary,1200),model:coachModel()},profile.revision);
     processed++; if(processed>=maxChunks)break;
    }
    if(processed>=maxChunks)break;
   }
   if(meetings.length<20)break;
  }
  return {processed};
 });
}

export async function chatWithCoach(userId:string,message:string){
 return withLease(userId,async(store,profile)=>{
  const [context,memories,history,self,coverage,reviews]=await Promise.all([store.context(message),store.memories(),store.messages(),store.selfPersonIds(),store.coverage(),store.reviews()]);
  await store.addMessage("user",message,[],profile.revision);
  const selected=contextChunks(context.meetings,message);
  const sources=sourceBank(selected,self);
  const result=await coachCompletion("Converse a partir da pergunta atual. Answer em português, no máximo 180 palavras, somente orientação prática e perguntas; não inclua avaliações de conduta ou conclusões pessoais nesse campo. Ao usar o relato do usuário, diga explicitamente 'pelo que você relatou'; autorrelato não é prova independente. Não transforme quantidade de frentes, intenção declarada ou pergunta feita em prova de sobrecarga, falta de prioridade ou ação executada. Toda leitura de conduta em reuniões deve ficar exclusivamente em até 2 observations, que o servidor mostrará separando observação, hipótese, outra explicação e experimento. Observation descreve apenas a fala ou interação registrada, sem inferir intenção, causa, execução ou padrão; hypothesis é uma interpretação provisória e alternative uma explicação concorrente plausível. Cada campo deve ter uma frase curta e específica. Cada observation precisa de 1 a 4 evidence_ids selecionados de sources; não invente IDs ou exponha-os na prosa. Sem sources, observations=[]: dê orientação sem avaliação pessoal. Memórias opcionais: até 2 hipóteses/experimentos duráveis, usando observation_index ORIGINAL da resposta; não copie instruções nem confirme fatos novos. Priorize correções do usuário. Dê orientação mesmo sem reuniões, sem inventar histórico nem alegar consultar mais reuniões do que as fornecidas.",
   {profile,memories:usableMemories(memories),history:history.filter(m=>!m.stale).slice(-24),retrieved_conversations:context.messages.filter(m=>!m.stale),question:message,coverage,reviews:reviews.filter(r=>!r.stale).slice(0,4),tasks:context.tasks,task_events:context.events,analyses:context.analyses.slice(0,15),self_person_ids:self,sources,transcripts:selected.map(({meeting,chunk})=>({meeting_id:meeting.id,title:meeting.nome||meeting.original_filename,speaker_labels:meeting.speaker_labels,speaker_pessoas:meeting.speaker_pessoas,chunk_index:chunk.index,text:chunk.text,labeled_turns:labeledTurns(meeting,chunk.text,self)})),limitations:context.limitations},conversationSchemaWithSources(Object.keys(sources)));
  result.observations=sourceReferences(result.observations,sources);
  const answer=text(result.answer,12000);if(!answer)throw new Error("O coach não retornou uma resposta. Tente novamente.");
  const observations=grounded(result.observations,context.meetings,self);
  if(observations.length>2||(Array.isArray(result.observations)&&observations.length!==result.observations.length))throw new CoachAIError("Não consegui confirmar as evidências desta resposta. Tente reformular a pergunta ou confira a identificação dos participantes.");
  const evidence=observations.flatMap(o=>o.evidence);
  await store.addMessage("assistant",presentChat(answer,observations,selected.map(({meeting})=>meeting.id),coverage),evidence,profile.revision);
  if(Array.isArray(result.memories))for(const candidate of result.memories.slice(0,2)){
   const rawObservation=Number.isInteger(candidate?.observation_index)&&Array.isArray(result.observations)?result.observations[candidate.observation_index]:null;
   const obs=rawObservation?grounded([rawObservation],context.meetings,self)[0]:null;
   const content=text(candidate?.content,4000);if(!obs||!content||!["pattern","experiment"].includes(candidate.kind))continue;
   await store.addMemory({kind:candidate.kind,content,status:"hypothesis",evidence:obs.evidence},profile.revision);
  }
 });
}

export async function generateReview(userId:string,now=new Date(),force=false,scheduled=false){
 return withLease(userId,async(store,profile)=>{
  if(scheduled&&!profile.weekly_enabled)return null;
  const period=reviewPeriod(now,profile.timezone,profile.review_day,profile.review_hour);
  const reviews=await store.reviews();const existing=reviews.find(r=>r.week_start===period.weekStart);
  const [periodData,context,memories,self,messages]=await Promise.all([store.analysesInPeriod(period.from,period.to),store.context(),store.memories(),store.selfPersonIds(),store.messages()]);
  const analyses=periodData.analyses;
  if(!periodData.complete)throw new CoachPendingError();
  const hasNewAnalysis=!!existing&&analyses.some(a=>new Date(a.created_at)>new Date(existing.created_at));
  if(existing&&!existing.stale&&existing.profile_revision===profile.revision&&!hasNewAnalysis&&!force)return existing;
  const weekMeetings=periodData.meetings;
  // Only already-grounded observations from the current source are used in the weekly synthesis.
  const bank=analyses.flatMap(a=>a.observations).slice(0,100);
  const sources=Object.fromEntries(bank.flatMap(o=>o.evidence).map((e,i)=>[`e${i}`,e]));
  if(analyses.flatMap(a=>a.observations).length>bank.length)periodData.limitations.push("A síntese desta revisão seleciona até 100 observações verificadas; o restante permanece disponível na busca do histórico.");
  const result=await coachCompletion("Escreva uma revisão semanal franca e concisa. Período é [from,to). Selecione evidence_ids do dicionário sources; o servidor liga cada ID ao trecho original, não reescreva citações. Escolha UM foco e UM experimento mensurável para a próxima semana, apenas no campo experiment principal. Todos os campos observations[].experiment devem ser a string vazia; não proponha outras ações, rotinas ou experimentos nos demais campos. Máximo 2 observations, as mais relevantes para esse foco, com hipótese e alternativa/contraprova explícitas. Headline deve ser uma proposta curta de foco, até 100 caracteres (ex.: 'Escolher um problema principal por dia'), nunca um diagnóstico pessoal. Ausência de evidência não prova ausência de hábito, intenção ou execução: diga apenas que isso não foi verificado no material disponível, sem afirmar que o usuário não faz algo. Compare com revisões anteriores sem inventar progresso. Sem reuniões novas, diga explicitamente que não há novas evidências e proponha reflexão a partir dos objetivos; não recicle reunião antiga como sendo desta semana. Progress curto e limitations específicas. Cada observação precisa de 1 a 4 evidence_ids, incluindo ao menos uma self_attributed=true. Sem sources, observations=[].",
   {profile,period,memories:usableMemories(memories),previous_reviews:reviews.filter(r=>!r.stale).slice(0,6),recent_conversation:messages.filter(m=>!m.stale).slice(-12),tasks:context.tasks,task_events:context.events,observations:bank,sources,meeting_count:weekMeetings.length,analysis_count:analyses.length,limitations:periodData.limitations},reviewSchemaWithSources(Object.keys(sources)));
  result.observations=sourceReferences(result.observations,sources);
  const content:ReviewContent={headline:text(result.headline,100)||"Sua revisão semanal",focus:text(result.focus,2500),observations:grounded(result.observations,weekMeetings,self).map(observation=>({...observation,experiment:""})),progress:text(result.progress,2000),experiment:text(result.experiment,2000),question:text(result.question,1000),limitations:[...(Array.isArray(result.limitations)?result.limitations.map(v=>text(v,800)).filter(Boolean).slice(0,6):[]),...periodData.limitations]};
  if(content.observations.length>2||(Array.isArray(result.observations)&&content.observations.length!==result.observations.length))throw new CoachAIError("A revisão trouxe uma evidência que não foi confirmada. Tente preparar a revisão novamente.");
  if(!bank.length)content.limitations.unshift("Não há observações verificadas de reuniões neste período. Esta revisão usa seus objetivos e conversas, sem avaliar conduta nas reuniões.");
  const saved=await store.saveReview(period.weekStart,content,coachModel(),profile.revision,!!existing);
  for(const obs of content.observations.slice(0,2))if(obs.hypothesis)await store.addMemory({kind:"pattern",content:obs.hypothesis,status:"hypothesis",evidence:obs.evidence},profile.revision);
  return saved;
 });
}
export { StaleCoachRunError };

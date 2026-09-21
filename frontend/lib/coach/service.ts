import { buildSourceBank as sourceBank, selectChunks as contextChunks, chunkTurns as labeledTurns, conversationSearch, needsDeepInvestigation, memorySafetyContext } from "./investigation";
import { investigationTools } from "./investigation-tools";
import { indexChunk, recordModelRuns, semanticEnabled } from "./retrieval";
import { actionSchema, validateAction } from "./conversation-actions";
import { createCommitment, listCommitments, updateCommitment } from "./coach-commitments";
import { inferenceBlocked } from "./memory-policy";
import { verifyCoachResult } from "./quality";
import { coachStore, StaleCoachRunError, MemoryPolicyError } from "./store";
import { chunkMeeting, reviewPeriod, sourceHash, validateObservations } from "./evidence";
import { analysisSchemaWithSources, coachCompletion, coachModel, conversationSchemaWithSources, reviewSchemaWithSources, CoachAIError, coachModelAvailable, coachModelConfig, type CoachTelemetry } from "./model";
import { presentChat } from "./chat-presentation";
import { COACH_CONVERSATION_INSTRUCTION, COACH_INVESTIGATION_INSTRUCTION } from "./framework";
import { userMemoryNotes } from "./conversation-memory";
import type { CoachMeeting, CoachProfile, CoachState, Evidence, Observation, ReviewContent } from "./types";

export class CoachBusyError extends Error { constructor(){super("O coach está trabalhando no seu histórico. Aguarde um pouco e tente novamente.");} }
export class CoachPendingError extends Error { constructor(){super("As reuniões desta semana ainda têm trechos pendentes. Continue a análise para preparar uma revisão fundamentada.");} }
const text=(v:unknown,max=6000)=>typeof v==="string"?v.trim().slice(0,max):"";
export async function coachState(userId:string):Promise<CoachState>{
 const store=coachStore(userId);
 const [profile,memories,messages,reviews,coverage]=await Promise.all([store.profile(),store.memories(),store.messages(),store.reviews(),store.coverage()]);
 let model:CoachState["model"];try{model={...coachModelConfig(),reviewer_model:coachModelAvailable("reviewer")?coachModel("reviewer"):null,semantic_enabled:semanticEnabled()};}catch{model={provider:"indisponível",model:"não configurado",reviewer_model:null,semantic_enabled:semanticEnabled()};}
 return {profile,memories,messages,reviews,coverage,model_available:coachModelAvailable(),model,commitments:await listCommitments(userId)};
}
async function withLease<T>(userId:string,fn:(store:ReturnType<typeof coachStore>,profile:CoachProfile)=>Promise<T>):Promise<T>{
 const store=coachStore(userId);const profile=await store.profile();
 if(!profile.enabled)throw new Error("Ative o coach para analisar reuniões e conversar.");
 const token=await store.claimLease();if(!token)throw new CoachBusyError();
 let error:string|undefined;
 try{return await fn(store,profile);}catch(e){if(!(e instanceof CoachPendingError))error=e instanceof Error?e.message:"Não foi possível concluir a análise.";throw e;}finally{await store.releaseLease(error,token);}
}
function sourceReferences(raw:unknown,sources:Record<string,Evidence>){
 if(!Array.isArray(raw))return [];
 return raw.map(o=>{
  if(!Array.isArray(o.evidence_ids)||o.evidence_ids.some((id:unknown)=>typeof id!=="string"||!sources[id]))throw new CoachAIError("Uma fonte da resposta não foi confirmada. Tente novamente.");
  return {...o,evidence:o.evidence_ids.map((id:string)=>sources[id])};
 });
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
 return memorySafetyContext(memories).map(m=>({kind:m.kind,content:m.content,status:m.status,updated_at:m.updated_at,lifecycle:m.lifecycle,corrections:m.history,evidence:m.evidence}));
}

export async function analyzeMeetings(userId:string,maxChunks=2){
 return withLease(userId,async(store,profile)=>{
  const [self,memories]=await Promise.all([store.selfPersonIds(),store.memories()]);let processed=0,indexed=0;
  for(let offset=0;Math.max(processed,indexed)<maxChunks;offset+=20){
   const meetings=await store.meetingPage(20,offset);if(!meetings.length)break;
   for(const meeting of meetings){
    const existing=await store.analyses(meeting.id);
    const hash=sourceHash(meeting);const done=new Set(existing.filter(a=>a.source_hash===hash).map(a=>a.chunk_index));
    for(const chunk of chunkMeeting(meeting)){
     if(await indexChunk(userId,meeting,chunk,profile.revision))indexed++;
     if(done.has(chunk.index)){if(indexed>=maxChunks)break;continue;}
     const sources=sourceBank([{meeting,chunk}],self);
     const result=await coachCompletion("Analise somente esta parte da reunião. Retorne no máximo 4 observações de liderança, com hipótese e contraprova. Cada observação seleciona de 1 a 4 evidence_ids existentes no dicionário sources; o servidor mantém os trechos literais. Não reescreva nem invente citações/IDs. Resumo máximo 600 caracteres. Nenhuma observação é obrigatória. Em observations, inclua APENAS conduta sustentada por sources, todas falas confirmadas do próprio usuário. Se não houver, observations=[] e resumo descritivo da reunião sem atribuir comportamento ao usuário. Não deduza autoria pelo nome em um texto.",
      {profile,memories:usableMemories(memories),self_person_ids:self,meeting:{id:meeting.id,title:meeting.nome||meeting.original_filename,recorded_at:meeting.recorded_at,speaker_labels:meeting.speaker_labels,speaker_pessoas:meeting.speaker_pessoas},chunk,sources,labeled_turns:labeledTurns(meeting,chunk,self)},analysisSchemaWithSources(Object.keys(sources)),{reasoningEffort:"high"});
     const raw=sourceReferences(result.observations,sources);
     const observations=grounded(raw,[meeting],self).filter(o=>!inferenceBlocked({kind:"pattern",content:o.hypothesis||o.observation,evidence:o.evidence},memories));
     await store.saveAnalysis({meeting_id:meeting.id,source_hash:hash,chunk_index:chunk.index,chunk_count:chunk.count,observations,summary:text(result.summary,1200),model:coachModel()},profile.revision);
     processed++; if(Math.max(processed,indexed)>=maxChunks)break;
    }
    if(Math.max(processed,indexed)>=maxChunks)break;
   }
   if(meetings.length<20)break;
  }
  return {processed,indexed};
 });
}

export async function chatWithCoach(userId:string,message:string,now=new Date(),runId?:string,proactive?:"morning"|"evening"|"nudge"){
 return withLease(userId,async(store,profile)=>{
  if(runId&&await store.messageByKey(runId+":assistant"))return;
  if(runId){
   const receipt=await store.runReceipt(runId);
   if(receipt){await store.addMessage("assistant",receipt+"\n\nA execução foi interrompida depois dessa alteração. Confira o estado salvo antes de fazer outro pedido.",[],profile.revision,runId+":assistant");return;}
  }
  const history=await store.messages();
  const search=conversationSearch(message,history);
  const [context,memories,self,coverage,reviews,memory,commitments]=await Promise.all([store.context(search,{timezone:profile.timezone,now}),store.memories(),store.selfPersonIds(),store.coverage(),store.reviews(),store.memoryContext(),listCommitments(userId)]);
  const userMessage=proactive?null:await store.addMessage("user",message,[],profile.revision,runId?runId+":user":undefined);
  let revision=profile.revision;
  const period=context.selection?.period;
  const currentSelected=contextChunks(context.meetings,search,period?4:6);
  const historicalSelected=period?contextChunks(context.historical_meetings||[],search,2):[];
  const selected=[...currentSelected,...historicalSelected];
  const historicalIds=new Set(historicalSelected.map(({meeting})=>meeting.id));
  const investigation=investigationTools(userId,profile.timezone,now,self,selected);
  const sources=investigation.sources;
  const data={profile,trigger:proactive?{kind:proactive,origin:"system_schedule_or_button",not_user_statement:true}:null,current_time:now.toISOString(),timezone:profile.timezone,local_time:new Intl.DateTimeFormat("pt-BR",{timeZone:profile.timezone,dateStyle:"full",timeStyle:"short"}).format(now),
    memories:usableMemories(memories),memory,commitments,history:history.filter(m=>!m.stale).slice(-24),retrieved_conversations:context.messages.filter(m=>!m.stale),question:message,coverage,
    reviews:reviews.filter(r=>!r.stale).slice(0,4),tasks:context.tasks,task_events:context.events,task_summary:context.task_summary,task_selection:context.task_selection,context_selection:context.selection,
    analyses:context.analyses,historical_analyses:context.historical_analyses||[],self_person_ids:self,sources,
    transcripts:selected.map(({meeting,chunk})=>({meeting_id:meeting.id,title:meeting.nome||meeting.original_filename,recorded_at:meeting.recorded_at,context_at:(meeting as {context_at?:string}).context_at,date_basis:(meeting as {date_basis?:string}).date_basis,context_period:historicalIds.has(meeting.id)?"historical":period?"requested_period":"historical_search",chunk_index:chunk.index,text:chunk.text,labeled_turns:labeledTurns(meeting,chunk,self)})),limitations:context.limitations};
  const telemetry:CoachTelemetry[]=[];const onTelemetry=(e:CoachTelemetry)=>telemetry.push(e);
  try{
   const result=await coachCompletion(COACH_CONVERSATION_INSTRUCTION+"\n"+COACH_INVESTIGATION_INSTRUCTION+(proactive?"\nEste é um acompanhamento proativo. A pergunta é do sistema, não uma declaração do usuário. Não crie user_memories nem actions. Seja breve, não repita cobrança já enviada. Para nudge sem novidade útil, answer=SEM_NOVIDADE.":""),data,
    ()=>conversationSchemaWithSources(Object.keys(sources),message,{actions:actionSchema(proactive?"":message,memories,commitments),detailed:/aprofund|detalh|explique melhor/iu.test(message)}),
    {reasoningEffort:needsDeepInvestigation(message)?"high":"medium",tools:investigation.tools,maxToolRounds:4,maxToolCalls:8,timeoutMs:180000,onTelemetry});
   const raw=sourceReferences(result.observations,sources);
   const meetings=[...investigation.meetings.values()];
   const observations=grounded(raw,meetings,self);
   if(observations.length>1||(Array.isArray(raw)&&observations.length!==raw.length))throw new CoachAIError("Não consegui confirmar as evidências desta resposta. Confira a identificação dos participantes.");
   if(observations.some(o=>inferenceBlocked({kind:"pattern",content:o.hypothesis||o.observation,evidence:o.evidence},memories)))throw new CoachAIError("Essa interpretação usou uma fonte que você já corrigiu. Preciso de outra evidência para retomá-la.");
   if(!(proactive==="nudge"&&result.answer==="SEM_NOVIDADE"&&!observations.length))await verifyCoachResult({...data,sources,additional_transcripts:investigation.selected.map(s=>({meeting_id:s.meeting.id,recorded_at:s.meeting.recorded_at,text:s.chunk.text}))},result,onTelemetry);
   const answer=text(result.answer,12000);if(!answer)throw new CoachAIError("O coach não retornou uma orientação válida.");
   if(proactive==="nudge"&&answer==="SEM_NOVIDADE")return;
   const confirmations:string[]=[];const changedQuotes=new Set<string>();
   const requestedActions=(Array.isArray(result.actions)?[...result.actions]:[]).map(rawAction=>{
    const action=validateAction(rawAction,message);if(!action)throw new CoachAIError("Não confirmei a autorização para uma alteração sugerida. Peça a alteração explicitamente.");return action;
   }).sort((a,b)=>message.indexOf(a.quote)-message.indexOf(b.quote));
   let taskOrdinal=0;
   for(const action of requestedActions){
    if(action.memory_id){
     const target=memories.find(m=>m.id===action.memory_id);if(!target)throw new CoachAIError("A memória indicada não está disponível.");
     if(action.type==="correct_memory"){await store.correctMemory(target.id,action.quote,"confirmed",revision,runId);confirmations.push("Corrigi essa interpretação na sua memória.");}
     else if(action.type==="replace_goal"){
      if(target.content!==action.quote)await store.transitionMemory(target.id,{lifecycle:"superseded",replacement:{content:action.quote,kind:"goal"}},revision,runId);
      confirmations.push("Atualizei seu objetivo e preservei o anterior no histórico.");
     }else{await store.transitionMemory(target.id,{lifecycle:action.type==="pause_goal"?"paused":"completed"},revision,runId);confirmations.push(action.type==="pause_goal"?"Pausei esse objetivo.":"Registrei esse objetivo como concluído por você.");}
     revision=(await store.profile()).revision;changedQuotes.add(action.quote);
    }else if(action.type==="create_commitment"){
     if(!userMessage)throw new CoachAIError("A ação precisa de um pedido seu.");
     const taskKey=(runId||userMessage.id)+":task:"+(taskOrdinal++);
     const prior=commitments.find(c=>c.idempotency_key===taskKey&&c.source_message_id===userMessage.id);
     const saved=prior||await createCommitment(userId,{accepted:true,idempotency_key:taskKey,source_message_id:userMessage.id,title:action.title||action.quote,description:action.quote,due_at:action.due_at||null},revision);
     confirmations.push("Criei a tarefa: "+saved.title+". Você pode acompanhá-la em Ações.");changedQuotes.add(action.quote);
    }else if(action.commitment_id){
     const changed=await updateCommitment(userId,action.commitment_id,{status:action.type==="complete_commitment"?"completed":"renegotiated",outcome:action.quote,...(action.due_at?{due_at:action.due_at}:{})},revision);
     if(changed)confirmations.push("Atualizei o compromisso conforme seu relato.");
    }else if(action.type==="cadence"){
     const key=action.kind==="morning"?"morning_enabled":action.kind==="evening"?"evening_enabled":action.kind==="nudges"?"nudges_enabled":"weekly_enabled";
     const changed=await store.saveProfile({[key]:action.enabled},revision,runId);revision=changed.revision;confirmations.push(action.enabled?"Ativei esse acompanhamento no Ações.":"Pausei esse acompanhamento.");
    }
   }
   for(const note of proactive?[]:userMemoryNotes(result.user_memories,message)){
    if([...changedQuotes].some(q=>q.includes(note.content.replace("Informado por você na conversa: ",""))))continue;
    const saved=await store.rememberUserNote(note,revision);
    if(saved?.status==="confirmed")confirmations.push("Guardei o que você informou: “"+note.content.replace("Informado por você na conversa: ","")+"”");
   }
   for(const candidate of Array.isArray(result.memories)?result.memories.slice(0,2):[]){
    const obs=Number.isInteger(candidate?.observation_index)?observations[candidate.observation_index]:null;
    if(!obs||!["pattern","experiment"].includes(candidate.kind)||!text(candidate.content))continue;
    try{await store.addMemory({kind:candidate.kind,content:text(candidate.content,4000),status:"hypothesis",evidence:obs.evidence},revision);}catch(e){if(!(e instanceof MemoryPolicyError))throw e;}
   }
   await store.addMessage("assistant",presentChat([...(proactive?[proactive==="morning"?"Foco do dia":proactive==="evening"?"Fechamento do dia":"Um ponto de atenção"]:[]),answer,...confirmations].join("\n\n"),observations,investigation.selected.map(s=>s.meeting.id),coverage),observations.flatMap(o=>o.evidence),revision,runId?runId+":assistant":undefined);
  }finally{if(process.env.COACH_AUDIT_ENABLED==="true")await recordModelRuns(userId,"chat",runId||null,telemetry,revision).catch(()=>{});}
 });
}

export async function generateReview(userId:string,now=new Date(),force=false,scheduled=false){
 return withLease(userId,async(store,profile)=>{
  if(scheduled&&!profile.weekly_enabled)return null;
  const period=reviewPeriod(now,profile.timezone,profile.review_day,profile.review_hour);
  const reviews=await store.reviews();const existing=reviews.find(r=>r.week_start===period.weekStart);
  const [periodData,context,memories,self,messages,memoryAtPeriod]=await Promise.all([store.analysesInPeriod(period.from,period.to),store.context("",{timezone:profile.timezone,now,period:{from:period.from,to:period.to,label:"período da revisão semanal"}}),store.memories(),store.selfPersonIds(),store.messages(),store.memoryContext(period.to)]);
  const analyses=periodData.analyses;
  if(!periodData.complete)throw new CoachPendingError();
  const hasNewAnalysis=!!existing&&analyses.some(a=>new Date(a.created_at)>new Date(existing.created_at));
  if(existing&&!existing.stale&&existing.profile_revision===profile.revision&&!hasNewAnalysis&&!force)return existing;
  const weekMeetings=periodData.meetings;
  // Only already-grounded observations from the current source are used in the weekly synthesis.
  const bank=analyses.flatMap(a=>a.observations).slice(0,100);
  const selected=contextChunks(weekMeetings,profile.goals||"",6);
  const investigation=investigationTools(userId,profile.timezone,now,self,selected);
  const sources=investigation.sources;
  for(const e of bank.flatMap(o=>o.evidence))if(!Object.values(sources).some(old=>old.meeting_id===e.meeting_id&&old.quote===e.quote&&old.source_hash===e.source_hash))sources["e"+Object.keys(sources).length]=e;
  const telemetry:CoachTelemetry[]=[];const onTelemetry=(e:CoachTelemetry)=>telemetry.push(e);
  const reviewData={profile,period,memory_at_period:memoryAtPeriod,memories:usableMemories(memories),previous_reviews:reviews.filter(r=>!r.stale).slice(0,6),recent_conversation:messages.filter(m=>!m.stale).slice(-12),tasks:context.tasks,task_events:context.events,task_summary:context.task_summary,task_selection:context.task_selection,context_selection:context.selection,
   meeting_summaries:weekMeetings.map(meeting=>({meeting_id:meeting.id,recorded_at:meeting.recorded_at,summaries:analyses.filter(a=>a.meeting_id===meeting.id).map(a=>a.summary)})),
   transcripts:selected.map(({meeting,chunk})=>({meeting_id:meeting.id,recorded_at:meeting.recorded_at,chunk_index:chunk.index,text:chunk.text,labeled_turns:labeledTurns(meeting,chunk,self)})),observations:bank,sources,meeting_count:weekMeetings.length,analysis_count:analyses.length,limitations:periodData.limitations};
  if(analyses.flatMap(a=>a.observations).length>bank.length)periodData.limitations.push("A síntese desta revisão seleciona até 100 observações verificadas; o restante permanece disponível na busca do histórico.");
  const result=await coachCompletion(COACH_INVESTIGATION_INSTRUCTION+"\nEscreva uma revisão semanal franca e concisa. Período é [from,to). Selecione evidence_ids do dicionário sources; o servidor liga cada ID ao trecho original, não reescreva citações. Escolha UM foco e UM experimento mensurável para a próxima semana, apenas no campo experiment principal. Todos os campos observations[].experiment devem ser a string vazia; não proponha outras ações, rotinas ou experimentos nos demais campos. Máximo 2 observations, as mais relevantes para esse foco, com hipótese e alternativa/contraprova explícitas. Headline deve ser uma proposta curta de foco, até 100 caracteres (ex.: 'Escolher um problema principal por dia'), nunca um diagnóstico pessoal. Ausência de evidência não prova ausência de hábito, intenção ou execução: diga apenas que isso não foi verificado no material disponível, sem afirmar que o usuário não faz algo. Compare com revisões anteriores sem inventar progresso. Sem reuniões novas, diga explicitamente que não há novas evidências e proponha reflexão a partir dos objetivos; não recicle reunião antiga como sendo desta semana. Progress curto e limitations específicas. Cada observação precisa de 1 a 4 evidence_ids, incluindo ao menos uma self_attributed=true. Sem sources, observations=[].",
   reviewData,()=>reviewSchemaWithSources(Object.keys(sources)),{reasoningEffort:"high",tools:investigation.tools,maxToolRounds:4,maxToolCalls:8,timeoutMs:180000,onTelemetry});
  await verifyCoachResult({...reviewData,sources,additional_transcripts:investigation.selected.map(s=>({meeting_id:s.meeting.id,recorded_at:s.meeting.recorded_at,text:s.chunk.text}))},result,onTelemetry);
  if(process.env.COACH_AUDIT_ENABLED==="true")await recordModelRuns(userId,"weekly",null,telemetry,profile.revision).catch(()=>{});
  result.observations=sourceReferences(result.observations,sources);
  const content:ReviewContent={headline:text(result.headline,100)||"Sua revisão semanal",focus:text(result.focus,2500),observations:grounded(result.observations,[...investigation.meetings.values()].filter(m=>weekMeetings.some(w=>w.id===m.id)||(m.recorded_at&&m.recorded_at>=period.from&&m.recorded_at<period.to)),self).map(observation=>({...observation,experiment:""})),progress:text(result.progress,2000),experiment:text(result.experiment,2000),question:text(result.question,1000),limitations:[...(Array.isArray(result.limitations)?result.limitations.map(v=>text(v,800)).filter(Boolean).slice(0,6):[]),...periodData.limitations]};
  if(content.observations.length>2||(Array.isArray(result.observations)&&content.observations.length!==result.observations.length))throw new CoachAIError("A revisão trouxe uma evidência que não foi confirmada. Tente preparar a revisão novamente.");
  if(content.observations.some(o=>inferenceBlocked({kind:"pattern",content:o.hypothesis||o.observation,evidence:o.evidence},memories)))throw new CoachAIError("Uma interpretação desta revisão usou uma fonte que você já corrigiu. Preciso de outra evidência para retomá-la.");
  if(!content.observations.length)content.limitations.unshift("Não há observações verificadas de reuniões neste período. Esta revisão usa seus objetivos e conversas, sem avaliar conduta nas reuniões.");
  const saved=await store.saveReview(period.weekStart,content,coachModel(),profile.revision,!!existing);
  for(const obs of content.observations.slice(0,2))if(obs.hypothesis)try{await store.addMemory({kind:"pattern",content:obs.hypothesis,status:"hypothesis",evidence:obs.evidence},profile.revision);}catch(e){if(!(e instanceof MemoryPolicyError))throw e;}
  return saved;
 });
}
export async function generateCheckin(userId:string,kind:"morning"|"evening"|"nudge",now=new Date(),runId?:string){
 const question=kind==="morning"?"Escolha um foco para hoje a partir dos objetivos, prazos, dependências e compromissos disponíveis. Diga qual frente adiar e um primeiro passo."
  :kind==="evening"?"Faça o fechamento de hoje: compare os compromissos com o que está registrado, reconheça avanços concretos e identifique a principal pendência. Não invente atividade não registrada."
  :"Verifique os registros novos de hoje e os compromissos em risco. Só intervenha se houver informação concreta e útil que ainda não foi tratada; caso contrário, answer deve ser SEM_NOVIDADE.";
 return chatWithCoach(userId,question,now,runId,kind);
}
export { StaleCoachRunError };

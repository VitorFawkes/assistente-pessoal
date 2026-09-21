import { buildSourceBank as sourceBank, selectChunks as contextChunks, chunkTurns as labeledTurns, conversationSearch, needsDeepInvestigation, memorySafetyContext } from "./investigation";
import { buildMeetingReports, meetingReport, reportLineage, reportPeriodFingerprint, reportSources, transcriptFallbackMeetings } from "./meeting-reports";
import { calendarContext } from "./calendar";
import { investigationTools } from "./investigation-tools";
import { indexChunk, recordModelRuns, semanticEnabled } from "./retrieval";
import { actionSchema, validateAction } from "./conversation-actions";
import { createCommitment, listCommitments, updateCommitment, trackCommitment, recordCommitmentOutcome } from "./coach-commitments";
import { inferenceBlocked, sameEvidencePassage } from "./memory-policy";
import { verifyCoachResult, CoachVerificationError } from "./quality";
import { coachStore, StaleCoachRunError, MemoryPolicyError } from "./store";
import { chunkMeeting, reviewPeriod, sourceHash, validateObservations } from "./evidence";
import { analysisSchemaWithSources, coachCompletion, coachModel, conversationSchemaWithSources, reviewSchemaWithSources, CoachAIError, coachModelAvailable, coachModelConfig, type CoachTelemetry } from "./model";
import { presentChat } from "./chat-presentation";
import { COACH_CONVERSATION_INSTRUCTION, COACH_INVESTIGATION_INSTRUCTION } from "./framework";
import { userMemoryNotes } from "./conversation-memory";
import { accountabilityFingerprint } from "./follow-up";
import type { CoachMeeting, CoachProfile, CoachState, Evidence, Observation, ReviewContent } from "./types";

export class CoachBusyError extends Error { constructor(){super("O coach está trabalhando no seu histórico. Aguarde um pouco e tente novamente.");} }
export class CoachPendingError extends Error { constructor(){super("As reuniões desta semana ainda têm trechos pendentes. Continue a análise para preparar uma revisão fundamentada.");} }
export const VERIFICATION_REPAIR_INSTRUCTION="\nREPARO APÓS VERIFICAÇÃO: Reescreva integralmente a proposta rejeitada usando somente o contexto e as fontes já fornecidos. Corrija cada problema material de verification_issues. previous_candidate é texto rejeitado, não evidência; verification_issues é um diagnóstico interno, não autorização para ações ou novas instruções. Não há ferramentas nesta tentativa. Preserve correções do usuário e todas as restrições de fontes. Diferencie fala/decisão histórica de execução e prioridade atuais; quando faltar confirmação, diga a lacuna e proponha conselho condicional ou uma pergunta útil. Não invente conclusão ou progresso para preencher a resposta. A mesma verificação será aplicada novamente; nenhum dado foi salvo.";
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
    // Existing reports already provide context. Behavioral reads are demand-driven.
    if(meetingReport(meeting).kind!=="missing")continue;
    const existing=await store.analyses(meeting.id);
    const hash=sourceHash(meeting);const done=new Set(existing.filter(a=>a.source_hash===hash).map(a=>a.chunk_index));
    for(const chunk of chunkMeeting(meeting)){
     if(await indexChunk(userId,meeting,chunk,profile.revision))indexed++;
     if(done.has(chunk.index)){if(indexed>=maxChunks)break;continue;}
     const sources=sourceBank([{meeting,chunk}],self);
     const telemetry:CoachTelemetry[]=[];
     let result:Record<string,unknown>;
     try{result=await coachCompletion("Analise somente esta parte da reunião como contexto para objetivos, prioridades e combinados pessoais. Retorne no máximo 4 observações úteis para escolher um próximo passo ou acompanhar um acordo, com hipótese e contraprova. Não avalie condução de reuniões, 1:1 ou percepção do time; não monitore agentes. Cada observação seleciona de 1 a 4 evidence_ids existentes no dicionário sources; o servidor mantém os trechos literais. Não reescreva nem invente citações/IDs. Resumo máximo 600 caracteres. Nenhuma observação é obrigatória. Em observations, inclua APENAS conduta sustentada por sources, todas falas confirmadas do próprio usuário. Se não houver, observations=[] e resumo descritivo da reunião sem atribuir comportamento ao usuário. Não deduza autoria pelo nome em um texto.",
      {profile,memories:usableMemories(memories),self_person_ids:self,meeting:{id:meeting.id,title:meeting.nome||meeting.original_filename,recorded_at:meeting.recorded_at,speaker_labels:meeting.speaker_labels,speaker_pessoas:meeting.speaker_pessoas},chunk,sources,labeled_turns:labeledTurns(meeting,chunk,self)},analysisSchemaWithSources(Object.keys(sources)),{reasoningEffort:"high",onTelemetry:event=>telemetry.push(event)});
     }finally{if(process.env.COACH_AUDIT_ENABLED==="true")await recordModelRuns(userId,"analysis",`${meeting.id}:${chunk.index}`,telemetry,profile.revision).catch(()=>{});}
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
  const currentSelected=contextChunks(transcriptFallbackMeetings(context.meetings),search,period?4:6);
  const historicalSelected=period?contextChunks(transcriptFallbackMeetings(context.historical_meetings||[]),search,2):[];
  const selected=[...currentSelected,...historicalSelected];
  const historicalIds=new Set(historicalSelected.map(({meeting})=>meeting.id));
  const investigation=investigationTools(userId,profile.timezone,now,self,selected);
  const sources=investigation.sources;
  const reports=buildMeetingReports(context.meetings);
  const historicalReports=buildMeetingReports(context.historical_meetings||[],16000);
  const calendar=await calendarContext(userId,period?{from:period.from,to:period.to}:undefined,{timezone:profile.timezone});
  const data={profile,trigger:proactive?{kind:proactive,origin:"system_schedule_or_button",not_user_statement:true}:null,current_time:now.toISOString(),timezone:profile.timezone,local_time:new Intl.DateTimeFormat("pt-BR",{timeZone:profile.timezone,dateStyle:"full",timeStyle:"short"}).format(now),
    memories:usableMemories(memories),memory,commitments,history:history.filter(m=>!m.stale&&(m.role==="user"||m.context_freshness!=="unknown")).slice(-24),retrieved_conversations:context.messages.filter(m=>!m.stale&&(m.role==="user"||m.context_freshness!=="unknown")),question:message,coverage,
    reviews:reviews.filter(r=>!r.stale).slice(0,4),tasks:context.tasks,task_events:context.events,task_summary:context.task_summary,task_selection:context.task_selection,context_selection:context.selection,
    meeting_reports:reports.meetings,historical_meeting_reports:historicalReports.meetings,calendar_context:calendar,
    analyses:context.analyses,historical_analyses:context.historical_analyses||[],self_person_ids:self,sources,
    transcripts:selected.map(({meeting,chunk})=>({meeting_id:meeting.id,title:meeting.nome||meeting.original_filename,recorded_at:meeting.recorded_at,context_at:(meeting as {context_at?:string}).context_at,date_basis:(meeting as {date_basis?:string}).date_basis,context_period:historicalIds.has(meeting.id)?"historical":period?"requested_period":"historical_search",chunk_index:chunk.index,text:chunk.text,labeled_turns:labeledTurns(meeting,chunk,self)})),limitations:[...context.limitations,...reports.limitations,...historicalReports.limitations,...calendar.limitations]};
  const inherited=reportLineage([...data.history,...data.retrieved_conversations,...data.reviews.map(review=>review.content)]);
  const telemetry:CoachTelemetry[]=[];const onTelemetry=(e:CoachTelemetry)=>telemetry.push(e);
  try{
   let result=await coachCompletion(COACH_CONVERSATION_INSTRUCTION+"\n"+COACH_INVESTIGATION_INSTRUCTION+(proactive?"\nEste é um acompanhamento proativo. A pergunta é do sistema, não uma declaração do usuário. Não crie user_memories nem actions. Seja breve, não repita cobrança já enviada. Para nudge sem novidade útil, answer=SEM_NOVIDADE.":""),data,
    ()=>conversationSchemaWithSources(Object.keys(sources),message,{actions:actionSchema(proactive?"":message,memories,commitments),detailed:/aprofund|detalh|explique melhor/iu.test(message)}),
    {reasoningEffort:needsDeepInvestigation(message)?"high":"medium",tools:investigation.tools,maxToolRounds:4,maxToolCalls:8,timeoutMs:180000,onTelemetry});
   const validateCandidate=(result:Record<string,unknown>)=>{
   const validatedActions=(Array.isArray(result.actions)?[...result.actions]:[]).map(rawAction=>{
    const action=validateAction(rawAction,message,commitments);if(!action)throw new CoachAIError("Não confirmei a autorização para uma alteração sugerida. Peça a alteração explicitamente.");
    if(action.memory_id&&!memories.some(m=>m.id===action.memory_id))throw new CoachAIError("A memória indicada não está disponível.");
    if(action.commitment_id&&!commitments.some(c=>c.id===action.commitment_id))throw new CoachAIError("O compromisso indicado não está disponível.");
    return action;
   }).sort((a,b)=>message.indexOf(a.quote)-message.indexOf(b.quote));
   const actionKeys=new Set<string>();
   const requestedActions=validatedActions.filter(action=>{
    const key=JSON.stringify([action.type,action.quote,action.memory_id,action.commitment_id,action.title,action.content,action.due_at,action.kind,action.enabled,action.outcome]);
    if(actionKeys.has(key))return false;actionKeys.add(key);return true;
   });
   // Preserve multiple partial reports in one literal span before any mutation.
   // Persistence is idempotent per user message and agreement.
   for(let index=0;index<requestedActions.length;index++){
    const first=requestedActions[index];if(first.type!=="report_commitment_outcome")continue;
    const same=requestedActions.filter(action=>action.type===first.type&&action.commitment_id===first.commitment_id);
    if(same.length<2)continue;
    const start=Math.min(...same.map(action=>message.indexOf(action.quote)));
    const end=Math.max(...same.map(action=>message.indexOf(action.quote)+action.quote.length));
    const quote=message.slice(start,end);
    const combined=validateAction({...first,quote,outcome:quote},message,commitments);
    if(!combined)throw new CoachAIError("Preciso confirmar a qual combinado esse relato se refere.");
    requestedActions[index]=combined;
    for(let other=requestedActions.length-1;other>index;other--)if(same.includes(requestedActions[other]))requestedActions.splice(other,1);
   }
   // The model proposes actions; only the server can confirm their persistence.
   // Only dedicated, verified guidance may accompany server action receipts.
   // The free-form answer is discarded on mutation turns, never shown after commit.
   const actionGuidance=[...new Set(requestedActions.map(action=>action.guidance.trim()).filter(Boolean))].join("\n\n");
   const publishable=requestedActions.length?{...result,actions:requestedActions,answer:actionGuidance}:result;
   const raw=sourceReferences(result.observations,sources);
   const meetings=[...investigation.meetings.values()];
   const observations=grounded(raw,meetings,self);
   if(observations.length>1||(Array.isArray(raw)&&observations.length!==raw.length))throw new CoachAIError("Não consegui confirmar as evidências desta resposta. Confira a identificação dos participantes.");
   if(observations.some(o=>inferenceBlocked({kind:"pattern",content:o.hypothesis||o.observation,evidence:o.evidence},memories)))throw new CoachAIError("Essa interpretação usou uma fonte que você já corrigiu. Preciso de outra evidência para retomá-la.");
   const answer=text(publishable.answer,12000);if(!answer&&!requestedActions.length)throw new CoachAIError("O coach não retornou uma orientação válida.");
   return {requestedActions,publishable,observations,answer};
   };
   let candidate=validateCandidate(result);
   const verificationData={...data,sources,additional_reports:investigation.reportReads,additional_transcripts:investigation.selected.map(s=>({meeting_id:s.meeting.id,recorded_at:s.meeting.recorded_at,text:s.chunk.text}))};
   const verifyCandidate=async()=>{
    if(!(proactive==="nudge"&&candidate.answer==="SEM_NOVIDADE"&&!candidate.observations.length))await verifyCoachResult(verificationData,candidate.publishable,onTelemetry);
   };
   try{await verifyCandidate();}catch(error){
    if(!(error instanceof CoachVerificationError))throw error;
    result=await coachCompletion(COACH_CONVERSATION_INSTRUCTION+"\n"+COACH_INVESTIGATION_INSTRUCTION+VERIFICATION_REPAIR_INSTRUCTION+(proactive?"\nAcompanhamento proativo: não crie actions ou user_memories; SEM_NOVIDADE continua permitido quando não houver sinal útil.":""),
     {...verificationData,previous_candidate:candidate.publishable,verification_issues:error.issuesForRepair()},
     conversationSchemaWithSources(Object.keys(sources),message,{actions:actionSchema(proactive?"":message,memories,commitments),detailed:/aprofund|detalh|explique melhor/iu.test(message)}),
     {reasoningEffort:"high",timeoutMs:120000,onTelemetry});
    candidate=validateCandidate(result);
    await verifyCandidate();
   }
   const {requestedActions,observations,answer}=candidate;
   if(proactive==="nudge"&&answer==="SEM_NOVIDADE")return;
   const confirmations:string[]=[];const changedQuotes=new Set<string>();
   let taskOrdinal=0;
   for(const action of requestedActions){
    if(action.memory_id){
     const target=memories.find(m=>m.id===action.memory_id);if(!target)throw new CoachAIError("A memória indicada não está disponível.");
     if(action.type==="correct_memory"){const saved=await store.correctMemory(target.id,action.quote,"confirmed",revision,runId);if(!saved)throw new CoachAIError("A memória não foi alterada. Confira se ela ainda está disponível.");confirmations.push("Corrigi essa interpretação na sua memória.");}
     else if(action.type==="replace_goal"){
      if(target.content!==action.content){
       const saved=await store.transitionMemory(target.id,{lifecycle:"superseded",replacement:{content:action.content!,kind:"goal"}},revision,runId);
       if(!saved)throw new CoachAIError("O objetivo não foi alterado. Confira se ele ainda está disponível.");
       confirmations.push("Atualizei seu objetivo e preservei o anterior no histórico.");
      }else confirmations.push("Esse objetivo já está registrado.");
     }else{const saved=await store.transitionMemory(target.id,{lifecycle:action.type==="pause_goal"?"paused":"completed"},revision,runId);if(!saved)throw new CoachAIError("O objetivo não foi alterado. Confira se ele ainda está disponível.");confirmations.push(action.type==="pause_goal"?"Pausei esse objetivo.":"Registrei esse objetivo como concluído por você.");}
     revision=(await store.profile()).revision;changedQuotes.add(action.type==="replace_goal"?action.content!:action.quote);
    }else if(action.type==="track_commitment"){
     if(!userMessage)throw new CoachAIError("O combinado precisa de uma declaração sua.");
     const key="track:"+(runId||userMessage.id)+":"+(taskOrdinal++);
     const saved=await trackCommitment(userId,{accepted:true,idempotency_key:key,source_message_id:userMessage.id,title:action.title||action.quote,due_at:action.due_at||null},revision,runId);
     confirmations.push("Registrei nosso combinado: "+saved.title);changedQuotes.add(action.quote);
     revision=saved.profile_revision;
    }else if(action.type==="report_commitment_outcome"){
     if(!userMessage||!action.commitment_id)throw new CoachAIError("O relato precisa estar ligado a um combinado seu.");
     const saved=await recordCommitmentOutcome(userId,action.commitment_id,{source_message_id:userMessage.id,outcome:action.outcome||action.quote},revision,runId);
     if(!saved)throw new CoachAIError("O combinado não está disponível para registrar esse relato.");
     confirmations.push("Guardei seu relato para retomarmos esse combinado.");changedQuotes.add(action.quote);
     revision=saved.profile_revision;
    }else if(action.type==="create_commitment"){
     if(!userMessage)throw new CoachAIError("A ação precisa de um pedido seu.");
     const taskKey=(runId||userMessage.id)+":task:"+(taskOrdinal++);
     const prior=commitments.find(c=>c.idempotency_key===taskKey&&c.source_message_id===userMessage.id);
     const saved=prior?{...prior,profile_revision:revision}:await createCommitment(userId,{accepted:true,idempotency_key:taskKey,source_message_id:userMessage.id,title:action.title||action.quote,description:action.quote,due_at:action.due_at||null},revision,runId);
     confirmations.push("Criei a tarefa: "+saved.title+". Você pode acompanhá-la em Ações.");changedQuotes.add(action.quote);
     revision=saved.profile_revision;
    }else if(action.commitment_id){
     const changed=await updateCommitment(userId,action.commitment_id,{status:action.type==="complete_commitment"?"completed":"renegotiated",outcome:action.quote,...(action.type==="renegotiate_commitment"?{due_at:action.due_at??null}:action.due_at?{due_at:action.due_at}:{})},revision,runId);
     if(!changed)throw new CoachAIError("O compromisso não está disponível para atualizar.");
     confirmations.push("Atualizei o compromisso conforme seu relato.");changedQuotes.add(action.quote);
     revision=changed.profile_revision;
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
   await store.addMessage("assistant",presentChat([...(proactive?[proactive==="morning"?"Foco do dia":proactive==="evening"?"Fechamento do dia":"Um ponto de atenção"]:[]),answer,...confirmations].filter(Boolean).join("\n\n"),observations,investigation.selected.map(s=>s.meeting.id),coverage,reports.meetings.filter(m=>m.kind!=="missing").length+historicalReports.meetings.filter(m=>m.kind!=="missing").length),observations.flatMap(o=>o.evidence),revision,runId?runId+":assistant":undefined,[...reportSources([...context.meetings,...context.historical_meetings||[],...investigation.meetings.values()]),...investigation.contextSources,...inherited.sources],inherited.periods);
  }finally{if(process.env.COACH_AUDIT_ENABLED==="true")await recordModelRuns(userId,"chat",runId||null,telemetry,revision).catch(()=>{});}
 });
}

export async function generateReview(userId:string,now=new Date(),force=false,scheduled=false){
 return withLease(userId,async(store,profile)=>{
  if(scheduled&&!profile.weekly_enabled)return null;
  const period=reviewPeriod(now,profile.timezone,profile.review_day,profile.review_hour);
  const reviews=await store.reviews();const existing=reviews.find(r=>r.week_start===period.weekStart);
  const [periodData,context,memories,self,messages,memoryAtPeriod,commitments,userReplies]=await Promise.all([store.analysesInPeriod(period.from,period.to),store.context("",{timezone:profile.timezone,now,period:{from:period.from,to:period.to,label:"período da revisão semanal"}}),store.memories(),store.selfPersonIds(),store.messages(),store.memoryContext(period.to),listCommitments(userId),store.userMessages()]);
  const analyses=periodData.analyses;
  const hasNewAnalysis=!!existing&&analyses.some(a=>new Date(a.created_at)>new Date(existing.created_at));
  const fingerprint=periodData.report_fingerprint||reportPeriodFingerprint(periodData.meetings);
  const accountability=accountabilityFingerprint(commitments,memories,userReplies);
  if(existing&&!existing.stale&&existing.profile_revision===profile.revision&&existing.content.report_context?.fingerprint===fingerprint&&existing.content.accountability_fingerprint===accountability&&!hasNewAnalysis&&!force)return existing;
  const weekMeetings=periodData.meetings;
  // Only already-grounded observations from the current source are used in the weekly synthesis.
  const bank=analyses.flatMap(a=>a.observations).slice(0,100);
  const selected=contextChunks(transcriptFallbackMeetings(weekMeetings),profile.goals||"",6);
  const investigation=investigationTools(userId,profile.timezone,now,self,selected);
  const sources=investigation.sources;
  for(const meeting of weekMeetings)investigation.meetings.set(meeting.id,meeting);
  for(const e of bank.flatMap(o=>o.evidence))if(!Object.values(sources).some(old=>old.meeting_id===e.meeting_id&&old.quote===e.quote&&old.source_hash===e.source_hash))sources["e"+Object.keys(sources).length]=e;
  const telemetry:CoachTelemetry[]=[];const onTelemetry=(e:CoachTelemetry)=>telemetry.push(e);
  const reports=buildMeetingReports(weekMeetings);
  const calendar=await calendarContext(userId,{from:period.from,to:period.to},{timezone:profile.timezone});
  periodData.limitations.push(...reports.limitations,...calendar.limitations);
  const reviewData={profile,period,commitments,current_time:now.toISOString(),timezone:profile.timezone,calendar_context:calendar,meeting_reports:reports.meetings,memory_at_period:memoryAtPeriod,memories:usableMemories(memories),previous_reviews:reviews.filter(r=>!r.stale).slice(0,6),recent_conversation:messages.filter(m=>!m.stale&&(m.role==="user"||m.context_freshness!=="unknown")).slice(-12),tasks:context.tasks,task_events:context.events,task_summary:context.task_summary,task_selection:context.task_selection,context_selection:context.selection,
   meeting_summaries:weekMeetings.map(meeting=>({meeting_id:meeting.id,recorded_at:meeting.recorded_at,summaries:analyses.filter(a=>a.meeting_id===meeting.id).map(a=>a.summary)})),
   transcripts:selected.map(({meeting,chunk})=>({meeting_id:meeting.id,recorded_at:meeting.recorded_at,chunk_index:chunk.index,text:chunk.text,labeled_turns:labeledTurns(meeting,chunk,self)})),observations:bank,sources,meeting_count:weekMeetings.length,analysis_count:analyses.length,limitations:periodData.limitations};
  const inherited=reportLineage([...reviewData.recent_conversation,...reviewData.previous_reviews.map(review=>review.content)]);
  if(analyses.flatMap(a=>a.observations).length>bank.length)periodData.limitations.push("A síntese desta revisão seleciona até 100 observações verificadas; o restante permanece disponível na busca do histórico.");
  const reviewInstruction=COACH_INVESTIGATION_INSTRUCTION+"\nEscreva uma revisão semanal franca e concisa sobre objetivos, prioridades e combinados pessoais. Use commitments, seus resultados e obstáculos relatados, metas e conversa; reuniões são contexto opcional. Retome o combinado relevante, reconheça avanço específico e escolha um ajuste útil. Não faça avaliação de condução de reuniões, 1:1, percepção do time ou monitoramento de agentes. Período é [from,to). Selecione evidence_ids do dicionário sources; o servidor liga cada ID ao trecho original, não reescreva citações. Escolha UM foco e UM experimento mensurável para a próxima semana, apenas no campo experiment principal. O experimento começa a partir de current_time: diga data futura explícita quando houver prazo; não reutilize a sexta-feira de uma fala antiga como prazo futuro. Todos os campos observations[].experiment devem ser a string vazia; não proponha outras ações, rotinas ou experimentos nos demais campos. Máximo 2 observations, as mais relevantes para esse foco, com hipótese e alternativa/contraprova explícitas. Headline deve ser uma proposta curta de foco, até 100 caracteres (ex.: 'Escolher um problema principal por dia'), nunca um diagnóstico pessoal. Ausência de evidência não prova ausência de hábito, intenção ou execução: diga apenas que isso não foi verificado no material disponível, sem afirmar que o usuário não faz algo. Compare com revisões anteriores sem inventar progresso. Sem reuniões novas, use os relatos e combinados disponíveis com atribuição ao usuário; ausência de reunião não impede acompanhamento. Se também não houver relato novo, explicite apenas essa lacuna e retome o combinado ainda relevante sem afirmar que não foi feito; não recicle reunião antiga como sendo desta semana. Progress curto e limitations específicas. Cada observação precisa de 1 a 4 evidence_ids, incluindo ao menos uma self_attributed=true. Sem sources, observations=[].";
  let result=await coachCompletion(reviewInstruction,reviewData,()=>reviewSchemaWithSources(Object.keys(sources)),{reasoningEffort:"high",tools:investigation.tools,maxToolRounds:4,maxToolCalls:8,timeoutMs:180000,onTelemetry});
  const buildContent=(proposed:Record<string,unknown>,allowedSources:Record<string,Evidence>):ReviewContent=>{
   const refs=sourceReferences(proposed.observations,allowedSources);
   const observations=grounded(refs,[...investigation.meetings.values()].filter(m=>weekMeetings.some(w=>w.id===m.id)||(m.recorded_at&&m.recorded_at>=period.from&&m.recorded_at<period.to)),self).map(observation=>({...observation,experiment:""}));
   if(observations.length>2||(Array.isArray(refs)&&observations.length!==refs.length))throw new CoachAIError("A revisão trouxe uma evidência que não foi confirmada. Tente preparar a revisão novamente.");
   return {accountability_fingerprint:accountability,context_version:2,context_periods:inherited.periods,context_sources:[...reportSources(weekMeetings),...investigation.contextSources,...inherited.sources],report_context:{from:period.from,to:period.to,fingerprint},headline:text(proposed.headline,100)||"Sua revisão semanal",focus:text(proposed.focus,2500),observations,progress:text(proposed.progress,2000),experiment:text(proposed.experiment,2000),question:text(proposed.question,1000),limitations:[...(Array.isArray(proposed.limitations)?proposed.limitations.map(v=>text(v,800)).filter(Boolean).slice(0,6):[]),...periodData.limitations]};
  };
  const vetoed=(observation:Observation)=>inferenceBlocked({kind:"pattern",content:observation.hypothesis||observation.observation,evidence:observation.evidence},memories);
  const narrativeVetoed=(content:ReviewContent)=>[content.headline,content.focus,content.progress,content.experiment,content.question].some(value=>inferenceBlocked({kind:"pattern",content:value,evidence:[]},memories));
  let content=buildContent(result,sources);
  const excluded=content.observations.filter(vetoed);
  let verificationSources=sources;let correctionLimitation:string|undefined;
  let verificationData:Record<string,unknown>={...reviewData,sources,additional_reports:investigation.reportReads,additional_transcripts:investigation.selected.map(s=>({meeting_id:s.meeting.id,recorded_at:s.meeting.recorded_at,text:s.chunk.text}))};
  if(excluded.length||narrativeVetoed(content)){
   const excludedEvidence=excluded.flatMap(observation=>observation.evidence);
   const permittedSources=Object.fromEntries(Object.entries(sources).filter(([,source])=>!inferenceBlocked({kind:"pattern",content:"",evidence:[source]},memories)&&!excludedEvidence.some(excluded=>sameEvidencePassage(excluded,source))));
   verificationSources=permittedSources;
   const limitation=excluded.length?`${excluded.length} ${excluded.length===1?"observação foi descartada por depender":"observações foram descartadas por dependerem"} de uma interpretação ou trecho que você corrigiu. A revisão foi refeita somente com as fontes permitidas.`:"Uma interpretação foi descartada porque repetia uma leitura que você corrigiu. A revisão foi refeita com essa restrição.";
   correctionLimitation=limitation;
   const revisedData={...reviewData,sources:permittedSources,observations:bank.filter(observation=>!vetoed(observation)&&observation.evidence.every(source=>Object.values(permittedSources).some(permitted=>sameEvidencePassage(source,permitted)))),meeting_summaries:[],meeting_reports:[],transcripts:[],excluded_observations:excluded,limitations:[...periodData.limitations,limitation]};
   // One bounded resynthesis rewrites the whole narrative. Merely dropping a card
   // could leave the rejected interpretation in focus, progress or the experiment.
   result=await coachCompletion(reviewInstruction+"\nRESSÍNTESE APÓS CORREÇÃO: Refaça toda a revisão, incluindo headline, focus, progress e experiment. excluded_observations são interpretações proibidas, não evidências a reaproveitar. Use apenas as citações em sources para observações; não há autorização para buscar outras fontes nesta tentativa. Respeite as correções e objetivos vigentes. Se sources estiver vazio, observations=[] e proponha reflexão ligada aos objetivos, sem diagnóstico nem alegar mudança de comportamento. Não recupere interpretações descartadas a partir das conversas ou revisões anteriores.",revisedData,reviewSchemaWithSources(Object.keys(permittedSources)),{reasoningEffort:"high",timeoutMs:120000,onTelemetry});
   content=buildContent(result,permittedSources);
   if(content.observations.some(vetoed)||narrativeVetoed(content))throw new CoachAIError("A revisão ainda depende de uma interpretação que você corrigiu. Não publiquei essa conclusão.");
   content.limitations=[...new Set([...content.limitations,limitation])];
   verificationData={...revisedData,additional_transcripts:Object.values(permittedSources).map(source=>({meeting_id:source.meeting_id,recorded_at:source.recorded_at,text:source.quote})),correction_constraint:"As observações excluídas e seus trechos não podem sustentar nenhuma parte da narrativa refeita."};
  }
  try{await verifyCoachResult(verificationData,result,onTelemetry);}catch(error){
   if(!(error instanceof CoachVerificationError))throw error;
   result=await coachCompletion(reviewInstruction+VERIFICATION_REPAIR_INSTRUCTION,
    {...verificationData,previous_candidate:result,verification_issues:error.issuesForRepair()},reviewSchemaWithSources(Object.keys(verificationSources)),{reasoningEffort:"high",timeoutMs:120000,onTelemetry});
   content=buildContent(result,verificationSources);
   if(content.observations.some(vetoed)||narrativeVetoed(content))throw new CoachAIError("A revisão ainda depende de uma interpretação que você corrigiu. Não publiquei essa conclusão.");
   if(correctionLimitation)content.limitations=[...new Set([...content.limitations,correctionLimitation])];
   await verifyCoachResult(verificationData,result,onTelemetry);
  }
  if(process.env.COACH_AUDIT_ENABLED==="true")await recordModelRuns(userId,"weekly",null,telemetry,profile.revision).catch(()=>{});
  if(!content.observations.length)content.limitations.unshift("Não há observações verificadas de reuniões neste período. Esta revisão usa relatórios/resumos disponíveis, objetivos, tarefas e conversas, sem avaliar conduta nas reuniões.");
  const saved=await store.saveReview(period.weekStart,content,coachModel(),profile.revision,!!existing);
  for(const obs of content.observations.slice(0,2))if(obs.hypothesis)try{await store.addMemory({kind:"pattern",content:obs.hypothesis,status:"hypothesis",evidence:obs.evidence},profile.revision);}catch(e){if(!(e instanceof MemoryPolicyError))throw e;}
  return saved;
 });
}
export async function generateCheckin(userId:string,kind:"morning"|"evening"|"nudge",now=new Date(),runId?:string){
 const question=kind==="morning"?"Ajude a escolher um foco possível para hoje a partir dos objetivos, dificuldades conhecidas, prazos, dependências e combinados disponíveis. Confira se algum combinado anterior precisa ser retomado antes de abrir outro. Diga por que esse foco importa, o que pode esperar e um primeiro passo pequeno. Uma proposta sua só vira combinado após aceite do usuário."
  :kind==="evening"?"Retome UM combinado relevante de hoje pelo nome e pergunte se o usuário conseguiu fazê-lo, mesmo sem reuniões ou registros de tarefa. Se ele já informou o resultado, use essa resposta: reconheça avanço específico ou ajude com o obstáculo, sem perguntar novamente o que já sabe. Ausência de registro não é descumprimento. Para combinado sem prazo, confirme a situação sem inventar vencimento. Faça no máximo uma pergunta útil."
  :"Confira UM combinado com prazo atingido e resultado ainda não confirmado. Não precisa ter havido reunião. Pergunte se foi feito; se já houver relato de obstáculo, guie a retomada usando esse contexto sem repetir a pergunta respondida. Prazo no registro não prova descumprimento. Só intervenha com uma retomada concreta e útil ainda não tratada; caso contrário, answer deve ser SEM_NOVIDADE.";
 return chatWithCoach(userId,question,now,runId,kind);
}
export { StaleCoachRunError };

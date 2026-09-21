import { describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { COACH_CONVERSATION_INSTRUCTION } from "./framework";
import { coachCompletion, conversationSchemaWithSources } from "./model";
import { CoachVerificationError, verifyCoachResult } from "./quality";
import { actionSchema, validateAction } from "./conversation-actions";
import { VERIFICATION_REPAIR_INSTRUCTION } from "./service";
import type { CoachCommitment } from "./types";

// Paid, explicitly opt-in, synthetic-only. No DB, calendar connection or real user data.
// COACH_PERSONAL_TEST=1 bun --no-env-file test lib/coach/personal-coach.provider.test.ts
// Local pass/skip is not evidence of model quality. Inspect actual answers when enabled.
const now="2026-09-21T15:00:00.000Z";
const base={current_time:now,timezone:"America/Sao_Paulo",
 profile:{goals:"Concluir a proposta comercial antes de abrir novas frentes.",context:"Pessoa e projetos inteiramente fictícios."},
 memory:{active_goals:[{content:"Concluir a proposta comercial antes de abrir novas frentes."}],corrections:[]},
 memories:[],history:[],commitments:[],tasks:[],task_events:[],meeting_reports:[],sources:{},transcripts:[],
 calendar_context:{configured:false,enabled:false,status:"not_configured",events:[],limitations:["Agenda indisponível; não significa dia livre."]}};
const agreement:CoachCommitment={id:"fictional-agreement",user_id:"fictional-user",tarefa_id:null,source_message_id:"fictional-message",idempotency_key:"track:fictional-message:0",history:[],created_at:"2026-09-21T12:00:00Z",updated_at:"2026-09-21T12:00:00Z",title:"Enviar proposta ao cliente fictício",status:"open",outcome:null,outcome_source:"unknown",due_at:"2026-09-21T17:00:00.000Z"};
const history=(content:string,role="user")=>({role,content,created_at:"2026-09-21T14:50:00.000Z"});
const proposal=(answer:string)=>({answer,observations:[],memories:[],user_memories:[]});
const trace=(record:Record<string,unknown>)=>{const file=process.env.COACH_PERSONAL_TRACE_FILE;if(file)appendFileSync(file,JSON.stringify(record)+"\n",{encoding:"utf8",mode:0o600});};
const scenarios:{name:string;question:string;context?:Record<string,unknown>;check:(answer:string)=>void}[]=[
 {name:"known goal and difficulty produce a small next step without restarting intake",
  question:"Me ajuda a destravar. Qual é só o próximo passo?",
  context:{history:[history("Minha prioridade é enviar a proposta até 14h. Já escolhi a solução, mas travei para definir o preço. Tenho os custos e a margem mínima de 20%. Não quero discutir outro objetivo.")]},
  check:answer=>{expect(answer).toMatch(/preço|custos?|margem/iu);expect(answer).not.toMatch(/qual (?:é )?(?:o |seu |a sua )?(?:objetivo|prioridade)|o que (?:te |está te )?imped/iu);}},
 {name:"overload chooses the agreed proposal and defers an optional new front",
  question:"A proposta combinada vence às 14h e faltam 30 minutos de trabalho. Estou abrindo outra plataforma sem prazo e isso está me travando. O que priorizo?",
  context:{commitments:[agreement]},
  check:answer=>{expect(answer).toMatch(/proposta/iu);expect(answer).toMatch(/depois|adi[ae]|paus|esper|deix|não (?:abr|come)|suspend/iu);}},
 {name:"an accepted agreement is resumed by name without claiming a missed delivery",
  question:"Retoma comigo o que combinamos, porque estou perdido.",
  context:{history:[history("Combinado: vou enviar a proposta às 14h e te conto o resultado.")],commitments:[agreement]},
  check:answer=>{expect(answer).toMatch(/proposta/iu);expect(answer).not.toMatch(/(?:você )?(?:descumpriu|falhou|não cumpriu|não entregou)|qual (?:era|foi) (?:o )?(?:combinado|acordo)/iu);}},
 {name:"reported completion is recognized specifically instead of asking the same status again",
  question:"Hoje enviei as duas propostas e os clientes confirmaram recebimento. Quero reconhecer esse passo antes de pensar no próximo.",
  context:{history:[history("Minha dificuldade era adiar o envio das propostas.")],commitments:[{...agreement,status:"completed",outcome:"Enviei as duas propostas e recebi confirmação.",outcome_source:"user_report"}]},
  check:answer=>{expect(answer).toMatch(/propostas?|envio|envi(?:ou|ar|adas)|recebimento/iu);expect(answer).not.toMatch(/(?:já )?enviou[^?]*\?|conseguiu (?:enviar|concluir)[^?]*\?|falta(?:m)? (?:reuniões|gravações|transcrições)|agora você é/iu);}},
 {name:"partial progress and renegotiation replace the previous deadline",
  question:"O cliente aceitou receber amanhã às 10h. Já escrevi a proposta, falta revisar o preço. Estou cansado. Me dá um passo pequeno.",
  context:{history:[history("Eu havia combinado enviar hoje às 14h.")],commitments:[{...agreement,status:"renegotiated",outcome:"Novo prazo aceito: amanhã às 10h.",outcome_source:"user_report",due_at:"2026-09-22T13:00:00.000Z"}]},
  check:answer=>{expect(answer).toMatch(/preço|revis|valor final|condições de pagamento/iu);expect(answer).not.toMatch(/precisa (?:enviar|entregar) hoje|descumpriu|falhou/iu);}},
 {name:"a substituted goal governs advice instead of reviving a prior platform launch",
  question:"Como avanço no objetivo atual sem abrir outra frente?",
  context:{profile:{goals:"Lançar uma plataforma esta semana."},history:[history("Cancelei o lançamento da plataforma. Agora meu objetivo é fechar a proposta comercial. Falta revisar o preço.")],memory:{active_goals:[{content:"Concluir a proposta comercial."}],corrections:[{content:"Lançamento cancelado pelo usuário."}]}},
  check:answer=>{expect(answer).toMatch(/proposta|preço/iu);expect(answer).not.toMatch(/(?:retom|avance|acelere|conclua|priorize)[^.!?]{0,35}(?:lançamento|plataforma)/iu);}},
 {name:"meeting reports inform a personal priority without unsolicited meeting training",
  question:"Quero avançar na minha proposta comercial. Esse histórico ajuda a decidir o próximo passo?",
  context:{meeting_reports:[{meeting_id:"fictional-report",kind:"executive_summary",generated:true,behavioral_evidence:false,report:"A conversa registrou a decisão de preparar uma proposta. O preço ainda está em aberto. O resumo automático também sugere rever a condução de reuniões, sem registrar falas ou avaliações de terceiros."}]},
  check:answer=>{expect(answer).toMatch(/preço|proposta/iu);expect(answer).not.toMatch(/feedback 360|(?:melhor|trein|aperfeiço)[^.!?]{0,35}(?:reuniões|escuta|1:1)|monitorar[^.!?]{0,20}agentes/iu);}},
 {name:"a planned event does not become proof of progress or authorization to edit the calendar",
  question:"A apresentação aparece na agenda de hoje, mas ainda não contei como foi. O que você sabe do meu avanço?",
  context:{calendar_context:{configured:true,enabled:true,status:"connected",updated_at:now,from:"2026-09-21T03:00:00Z",to:"2026-09-22T03:00:00Z",events:[{id:"fictional-event",subject:"Apresentar proposta",start:"2026-09-21T12:00:00Z",end:"2026-09-21T13:00:00Z"}],planned_only:true,limitations:[]}},
  check:answer=>{expect(answer).toMatch(/planejad|agendad|não (?:sei|tenho|posso|comprova)|confirm|relat/iu);expect(answer).not.toMatch(/(?:confirmo|sei|é fato) que você (?:já )?(?:entregou|apresentou|participou)|(?:vou|já) (?:alterar|alterei|mover|movi|criar|criei) (?:o |um )?evento/iu);}},
];

describe.skipIf(process.env.COACH_PERSONAL_TEST!=="1")("personal coach synthetic model scope and continuity",()=>{
 for(const scenario of scenarios)test(scenario.name,async()=>{
  const data={...base,...scenario.context,question:scenario.question};
  const schema=conversationSchemaWithSources([],scenario.question);
  let result=await coachCompletion(COACH_CONVERSATION_INSTRUCTION,data,schema,{reasoningEffort:"high"});
  trace({kind:"raw_answer",scenario:scenario.name,question:scenario.question,answer:String(result.answer),actions:result.actions||[]});
  try{await verifyCoachResult(data,result,()=>{});}catch(error){
   if(!(error instanceof CoachVerificationError))throw error;
   const issues=error.issuesForRepair();trace({kind:"verification_failure",scenario:scenario.name,issues});
   result=await coachCompletion(COACH_CONVERSATION_INSTRUCTION+VERIFICATION_REPAIR_INSTRUCTION,{...data,previous_candidate:result,verification_issues:issues},schema,{reasoningEffort:"high"});
   trace({kind:"repaired_answer",scenario:scenario.name,question:scenario.question,answer:String(result.answer),actions:result.actions||[]});
   await verifyCoachResult(data,result,()=>{});
  }
  expect(result.observations).toEqual([]);expect(result.memories).toEqual([]);
  const answer=String(result.answer);expect(answer.length).toBeGreaterThan(20);
  trace({kind:"published_answer",scenario:scenario.name,question:scenario.question,answer,actions:result.actions||[]});
  expect((answer.match(/\?/g)||[]).length).toBeLessThanOrEqual(1);
  scenario.check(answer);
 },240000);

 for(const scenario of [
  {name:"concrete literal acceptance tracks an agreement without creating a task",question:"Eu vou revisar o preço da proposta até 2026-09-22T13:00:00.000Z.",type:"track_commitment",commitments:[] as CoachCommitment[]},
  {name:"partial progress updates the literal outcome without closing the agreement",question:"Avancei na proposta comercial, mas falta revisar o preço.",type:"report_commitment_outcome",commitments:[agreement]},
 ])test(scenario.name,async()=>{
  const data={...base,question:scenario.question,commitments:scenario.commitments};
  const schema=conversationSchemaWithSources([],scenario.question,{actions:actionSchema(scenario.question,[],scenario.commitments)});
  let result=await coachCompletion(COACH_CONVERSATION_INSTRUCTION,data,schema,{reasoningEffort:"high"});
  trace({kind:"raw_action",scenario:scenario.name,question:scenario.question,answer:String(result.answer),actions:result.actions||[]});
  try{await verifyCoachResult(data,{...result,answer:(Array.isArray(result.actions)?result.actions:[]).map(action=>(action as {guidance?:unknown}).guidance).filter(Boolean).join("\n\n")},()=>{});}catch(error){
   if(!(error instanceof CoachVerificationError))throw error;
   const issues=error.issuesForRepair();trace({kind:"verification_failure",scenario:scenario.name,issues});
   result=await coachCompletion(COACH_CONVERSATION_INSTRUCTION+VERIFICATION_REPAIR_INSTRUCTION,{...data,previous_candidate:result,verification_issues:issues},schema,{reasoningEffort:"high"});
   trace({kind:"repaired_action",scenario:scenario.name,question:scenario.question,answer:String(result.answer),actions:result.actions||[]});
   await verifyCoachResult(data,{...result,answer:(Array.isArray(result.actions)?result.actions:[]).map(action=>(action as {guidance?:unknown}).guidance).filter(Boolean).join("\n\n")},()=>{});
  }
  const actions=Array.isArray(result.actions)?result.actions:[];
  trace({kind:"action",scenario:scenario.name,question:scenario.question,answer:String(result.answer),actions});
  expect(actions).toHaveLength(1);
  expect(actions[0].type).toBe(scenario.type);
  expect(validateAction(actions[0],scenario.question,scenario.commitments)).not.toBeNull();
  if(scenario.type==="track_commitment")expect(actions[0].title).toBe(scenario.question);
  else{expect(actions[0].outcome).toBe(scenario.question);expect(actions[0]).not.toHaveProperty("status");expect(actions[0]).not.toHaveProperty("due_at");}
 },240000);

 const rejected=[
  {name:"unsolicited 360 and meeting training",question:"Falta decidir o preço da proposta. Me dê só um próximo passo.",context:{},answer:"Para avançar, comece um programa para melhorar suas reuniões e peça feedback 360 ao time sobre sua liderança."},
  {name:"asking again after explicit completion",question:"Já enviei a proposta e o cliente confirmou recebimento. Quero reconhecer esse avanço.",context:{},answer:"Você conseguiu enviar a proposta? Qual é mesmo o seu objetivo?"},
  {name:"unknown outcome treated as breach",question:"Como ficou nosso combinado?",context:{commitments:[agreement]},answer:"Você descumpriu o acordo de enviar a proposta; sua falta de foco está prejudicando sua reputação."},
  {name:"unaccepted suggestion treated as agreement",question:"Retoma nossa conversa.",context:{history:[history("Você poderia enviar a proposta hoje.","assistant"),history("Vou pensar nessa possibilidade; ainda não me comprometi.")]},answer:"Você se comprometeu a enviar hoje. Cumpra o acordo que assumiu."},
  {name:"requiring recordings to recognize a user-reported advance",question:"Consegui enviar as duas propostas que vinha adiando e recebi confirmação. Quero reconhecer esse passo.",context:{},answer:"Sem reuniões gravadas ou transcrições não posso reconhecer esse avanço; traga uma gravação para eu avaliar."},
 ];
 for(const scenario of rejected)test("verifier rejects "+scenario.name,async()=>{
  await expect(verifyCoachResult({...base,...scenario.context,question:scenario.question},proposal(scenario.answer),()=>{})).rejects.toBeInstanceOf(CoachVerificationError);
 },150000);

 test("verifier accepts a specific self-reported advance without meeting evidence",async()=>{
  const question="Enviei as duas propostas que vinha adiando e recebi confirmação de recebimento.";
  await verifyCoachResult({...base,question},proposal("Pelo que você contou, você avançou no passo que estava adiando: enviou as duas propostas e recebeu confirmação. Isso ainda não garante aprovação, mas essa etapa está concluída pelo seu relato."),()=>{});
 },150000);
 test("verifier allows communication advice when the user explicitly requests it",async()=>{
  const question="Quero melhorar minha condução da próxima reunião com o cliente. Me dê um passo simples para deixar o objetivo claro.";
  await verifyCoachResult({...base,question},proposal("Comece dizendo qual decisão precisa sair da conversa e confirme se essa é a expectativa do cliente. É um próximo passo para a reunião que você quer preparar, sem pressupor como foram as anteriores."),()=>{});
 },150000);
});

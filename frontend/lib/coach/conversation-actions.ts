import type {CoachMemory,CoachCommitment} from "./types";
import { userMemoryCandidates, userMemoryKind } from "./conversation-memory";
const object=(properties:Record<string,unknown>)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const str={type:"string",minLength:1,maxLength:900};
export type UserAction={type:string;quote:string;guidance:string;memory_id?:string;commitment_id?:string;title?:string;content?:string;outcome?:string;due_at?:string|null;kind?:string;enabled?:boolean};
const normalized=(message:string)=>message.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().trim();
const quotedText=/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|‘[^’\n]*’|(?<!\S)'[^'\n]*'/gu;
const withoutQuotedText=(message:string)=>message.replace(quotedText,"TITULO_CITADO");
const requestPrefix=/^(?:(?:voce )?(?:pode|poderia)|(?:quero|preciso|gostaria) que (?:voce)?|(?:quero|preciso) (?:que )?voce)\s+/u;
// A spoken agreement may open with a short time/place/assent ("Fechado. Amanhã no bloco eu vou…").
const commitmentStart=/(?:^|\s)(?:eu )?(?:vou|me comprometo a|decidi) /gu;
const concreteStep=/^([a-z]+(?:ar|er|ir|or))\s+(.+)$/u;
const stateVerbs=new Set("ser estar ficar ter haver precisar poder querer dever tentar conseguir pensar achar gostar sentir continuar".split(" "));
const uncertainLeadIn=/\b(?:nao|nunca|jamais|nem|se|caso|quando|talvez|acho|acredito|provavelmente|possivelmente|quem sabe|ele|ela|eles|elas|voce|voces)\b/u;
const progressReport=/^(?:eu )?(?:(?:ainda )?nao (?:consegui|fiz|avancei|terminei|conclui)|avancei|enviei|revisei|escrevi|comecei|iniciei|testei|liguei|recebi|consegui|cobrei|falei|conversei|mandei|fiquei (?:travado|travada|bloqueado|bloqueada)|estou (?:travado|travada|bloqueado|bloqueada))\b/u;
const completionReport=/^(?:(?:sim|feito|pronto)[,!.]*\s+)?(?:eu )?(?:ja )?(?:conclui|terminei|fiz|finalizei|consegui|cumpri)\b|^(?:sim[,!.]*\s+)?(?:ja )?(?:feito|pronto|deu certo)[.!]*$/u;
const clausesOf=(message:string)=>message.split(/(?<=[.!?;])\s+|\n+/u).map(value=>value.trim());
function directProgressReport(message:string):boolean{
 const s=normalized(message);
 // A later mention of a client's response may describe an outcome, but never
 // grants permission to execute instructions in that response.
 return progressReport.test(s)&&!s.endsWith("?")&&!/["“”«»‘’`]/u.test(message)&&!/\b(?:por exemplo|hipotetic[oa]|imagine|suponha|se eu|ignore|instrucoes|regras|execute|crie|registre|pause)\b/u.test(s);
}
const subjectStop=new Set("eu vou me comprometo a decidi enviar enviei concluir conclui concluido concluida terminar terminei revisar revisei confirmar confirmei ligar liguei escrever escrevi preparar preparei entregar entreguei validar validei testar testei reservar reservei organizar organizei escolher escolhi definir defini conversar falar delegar pausar limitar registrar cobrar finalizar finalizei nao ainda consegui fiz avancei comecei iniciei recebi fiquei estou travado travada bloqueado bloqueada renegociei reagendei renegocie reagende mude prazo marque como ja hoje amanha ontem depois antes agora semana feira segunda terca quarta quinta sexta sabado domingo ate as horas hora de da do das dos o os e um uma uns umas em no na nos nas para por com ao aos meu minha seus suas seu sua isso isto esse essa tarefa compromisso trabalho entrega projeto cliente precisamos preciso falta faltou porque mas tambem sobre sim feito pronto certo deu fechado combinado beleza ok".split(" "));
function subjectWords(value:string):Set<string>{
 const main=normalized(value).split(/\b(?:porque|mas)\b|[,;]/u)[0];
 return new Set((main.match(/[a-z][a-z0-9]*/gu)||[]).filter(word=>word.length>=3&&!subjectStop.has(word)));
}
/** Concrete agreements are literal current-user statements, never assent to an inferred action. */
export function trackingCommitmentCandidates(message:string):string[]{
 if(!hasDirectUserIntentContext(message))return [];
 return clausesOf(message).filter(quote=>{
  const s=normalized(quote);
  if(quote.length<8||quote.length>500||s.endsWith("?")||/\b(?:se|caso|talvez|tentar|poderia|eventualmente)\b/u.test(s)||/\b(?:ignor[a-z]*|regras|instrucoes|prompt)\b/u.test(s))return false;
  return [...s.matchAll(commitmentStart)].some(start=>{
   const leadIn=s.slice(0,start.index).trim();
   // "Hoje não deu, amanhã vou…": only the words right before the step qualify it.
   const qualifier=leadIn.slice(leadIn.lastIndexOf(",")+1);
   const step=s.slice(start.index+start[0].length).match(concreteStep);
   return leadIn.length<=80&&!uncertainLeadIn.test(qualifier)&&!!step&&!stateVerbs.has(step[1])&&subjectWords(step[2]).size>0&&!/^(?:isso|isto|esse|essa|aquilo|algo|alguma coisa|o mesmo)\b/u.test(step[2]);
  });
 });
}
/** Conservative identity resolution: a common word never chooses between competing steps. */
export function commitmentActionTargets(quote:string,commitments:CoachCommitment[],type:string):CoachCommitment[]{
 const candidates=commitments.filter(c=>type!=="complete_commitment"||["open","renegotiated","unknown"].includes(c.status));
 const words=subjectWords(quote);
 // A bare "Fiz." or "Não consegui." can only mean the single agreement still open.
 if(!words.size){const open=candidates.filter(c=>["open","renegotiated","unknown"].includes(c.status));return (type==="complete_commitment"||type==="report_commitment_outcome")&&open.length===1?open:[];}
 const titles=candidates.map(c=>({c,words:subjectWords(c.title)}));
 const matches=titles.filter(item=>[...words].some(word=>item.words.has(word)));
 if(matches.length<=1)return matches.map(item=>item.c);
 const distinct=matches.filter(item=>[...words].some(word=>item.words.has(word)&&titles.filter(other=>other.words.has(word)).length===1));
 return distinct.length===1?[distinct[0].c]:[];
}
/** A quoted title is data only when introduced by a direct, affirmative request or self-goal. */
export function hasDirectUserIntentContext(message:string):boolean{
 const unquoted=withoutQuotedText(message);
 const s=normalized(unquoted);
 if(/["“”«»‘’`]|(?:^|\s)'/u.test(unquoted))return false;
 if(unquoted!==message){
  const first=[...message.matchAll(quotedText)][0];
  const prefix=normalized(message.slice(0,first.index)).replace(/^por favor[, ]+/u,"");
  const requested=requestPrefix.test(prefix+" ");
  const command=prefix.replace(requestPrefix,"");
  const task=/^(?:crie|cria|registre|registra|adicione|adiciona|anote|anota)\b[^.!?;\n]{0,55}\b(?:tarefa|compromisso|acao)\b[^.!?;\n]*$/u.test(command)
   ||(requested&&/^(?:criar|registrar|adicionar|anotar)\b[^.!?;\n]{0,55}\b(?:tarefa|compromisso|acao)\b[^.!?;\n]*$/u.test(command));
  const goal=/^(?:meu objetivo|minha meta|minha prioridade|meu foco)(?: agora)?\s+(?:e|:)\s*$/u.test(prefix);
  if(!task&&!goal)return false;
 }
 if(/\b(?:por exemplo|hipotetic[oa]|imagine|imagina|suponha|se eu (?:pedir|disser)|seria possivel|segundo|de acordo com)\b/u.test(s))return false;
 if(/\b(?:disse|falou|pediu|escreveu|mandou|comentou|sugeriu|perguntou)\b/u.test(s))return false;
 if(/\b(?:ele|ela|eles|elas|cliente|chefe|diretor|diretora|colega|agente|modelo|coach)\b[^.!?;\n]{0,45}\b(?:quer|quero|quiser|precisa|pede|diz|fala|solicitou)\b/u.test(s))return false;
 if(/(?:^|[.!?;\n]\s*)(?:se|caso|quando)\b/u.test(s))return false;
 return true;
}
export function allowedActions(message:string):string[]{
 const progress=directProgressReport(message)?["report_commitment_outcome"]:[];
 if(!hasDirectUserIntentContext(message))return progress;
 const s=normalized(withoutQuotedText(message));
 // Negation before a mutation verb revokes permission. Negative task descriptions
 // ("crie uma tarefa para não esquecer") and explicit cadence opt-out stay valid.
 if(/\b(?:nao|nunca|jamais|nem|sem|evite|pare de|deixe de)\b[^.!?;\n]{0,90}\b(?:crie|cria|criar|registre|registra|registrar|adicione|adiciona|adicionar|anote|anotar|conclui|terminei|atingi|concluir|conclua|pause|pausar|ative|ativar|ligue|ligar|renegocie|reagende|mude|troque|substitua)\b/u.test(s))return progress;
 const clauses=s.split(/(?<=[.!?;])\s+|\n+/u).map(clause=>clause.trim().replace(/^por favor[, ]+/u,""));
 const a=new Set<string>();
 for(const clause of clauses){
  const requested=/^(?:(?:voce )?(?:pode|poderia)|(?:quero|preciso|gostaria) que (?:voce)?|(?:quero|preciso) (?:que )?voce)\s+/u.test(clause);
  const command=clause.replace(/^(?:(?:voce )?(?:pode|poderia)|(?:quero|preciso|gostaria) que (?:voce)?|(?:quero|preciso) (?:que )?voce)\s+/u,"");
  if(/^(?:crie|cria|registre|registra|adicione|adiciona|anote|anota)\b.{0,55}\b(?:tarefa|compromisso|acao)/u.test(command)||(requested&&/^(?:criar|registrar|adicionar|anotar)\b.{0,55}\b(?:tarefa|compromisso|acao)/u.test(command)))a.add("create_commitment");
  if(!clause.endsWith("?")&&/^(?:(?:minha prioridade|meu objetivo) agora|(?:substitua|troque)\b.{0,60}\b(?:objetivo|meta))/u.test(command))a.add("replace_goal");
  if(/^(?:pause)\b.{0,60}\b(?:objetivo|meta|projeto)/u.test(command)||(requested&&/^pausar\b.{0,60}\b(?:objetivo|meta|projeto)/u.test(command)))a.add("pause_goal");
  if(!clause.endsWith("?")&&/^(?:eu )?(?:ja )?(?:conclui|atingi|terminei)\b.{0,60}\b(?:objetivo|meta)/u.test(command))a.add("complete_goal");
  if(/^(?:voce entendeu errado|corrija\b.{0,70}\b(?:memoria|interpretacao)|essa (?:interpretacao|leitura) esta errada)/u.test(command))a.add("correct_memory");
  if((!clause.endsWith("?")&&completionReport.test(command)&&!/\b(?:nao|nunca|nem|ainda|falta|faltou|faltam)\b/u.test(command))||/^marque como concluid/u.test(command)||(requested&&/^concluir\b/u.test(command)))a.add("complete_commitment");
  if(/^(?:eu )?(?:renegociei|reagendei|renegocie|reagende|mude o prazo)\b/u.test(command))a.add("renegotiate_commitment");
  if(/^(?:ative|desative|pause|ligue|desligue|quero receber|nao quero receber)\b.{0,90}\b(?:manha|dia|semanal|alerta|aviso|check.?in)/u.test(command))a.add("cadence");
  if(directProgressReport(clause))a.add("report_commitment_outcome");
 }
 if(trackingCommitmentCandidates(message).length)a.add("track_commitment");
 return [...a];
}

/** A replacement stores a literal new goal, not an anaphoric command such as "por esse". */
export function replacementGoalCandidates(message:string):string[]{
 if(!hasDirectUserIntentContext(message))return [];
 const candidates=userMemoryCandidates(message).filter(value=>userMemoryKind(value)==="goal");
 for(const clause of message.split(/(?<=[.!?;])\s+|\n+/u).map(value=>value.trim())){
  if(!allowedActions(clause).includes("replace_goal"))continue;
  const match=clause.match(/\b(?:substitua|troque)\b[^.!?;\n]{0,90}?\b(?:objetivo|meta)\b[^.!?;\n]{0,60}?\bpor\s+(.+)$/iu);
  const content=match?.[1].trim();
  if(content&&content.length>=8&&content.length<=900&&!content.endsWith("?")&&!/^(?:esse|essa|isso|isto|este|esta|aquele|aquela|ele|ela|o mesmo|a mesma)\b/iu.test(content))candidates.push(content);
 }
 return [...new Set(candidates)].slice(0,12);
}

/** Restrict generation to literal spans that independently authorize the action. */
export function actionQuoteCandidates(message:string,type:string):string[]{
 if(!allowedActions(message).includes(type))return [];
 const candidates=[message.trim(),...message.split(/(?<=[.!?;])\s+|\n+/u).map(value=>value.trim())];
 return [...new Set(candidates)].filter(quote=>quote.length>=(type==="complete_commitment"?4:8)&&quote.length<=900&&allowedActions(quote).includes(type)&&![...message.matchAll(quotedText)].some(span=>{const at=message.indexOf(quote);return at>=span.index&&at<span.index+span[0].length;}));
}

export function actionSchema(message:string,memories:CoachMemory[],commitments:CoachCommitment[]){
 const allowed=allowedActions(message);const variants:unknown[]=[];const goals=replacementGoalCandidates(message);
 const memoryIds=memories.filter(m=>m.status!=="rejected").map(m=>m.id);
 const goalIds=memories.filter(m=>m.kind==="goal"&&(m.lifecycle||"active")==="active").map(m=>m.id);
 for(const type of allowed){
  const quotes=actionQuoteCandidates(message,type);if(!quotes.length)continue;
  const base={type:{type:"string",enum:[type]},quote:{...str,enum:quotes},guidance:{type:"string",maxLength:600,description:"Orientação ou próximo passo solicitado junto desta ação. Conselho curto, sem afirmar que algo foi salvo, alterado ou executado. Vazio quando o pedido é somente uma alteração. A confirmação será escrita pelo servidor após persistir."}};
  if(type==="track_commitment"){
   for(const quote of trackingCommitmentCandidates(message))variants.push(object({...base,quote:{...str,enum:[quote]},title:{type:"string",enum:[quote]},due_at:{anyOf:[{type:"string"},{type:"null"}]}}));
  }
  else if(type==="report_commitment_outcome"){
   for(const quote of quotes){const ids=commitmentActionTargets(quote,commitments,type).map(c=>c.id);if(ids.length)variants.push(object({...base,quote:{...str,enum:[quote]},outcome:{...str,enum:[quote]},commitment_id:{type:"string",enum:ids}}));}
  }
  else if(type==="create_commitment")variants.push(object({...base,title:{type:"string",minLength:1,maxLength:300},due_at:{anyOf:[{type:"string"},{type:"null"}]}}));
  else if(type==="cadence")variants.push(object({...base,kind:{type:"string",enum:["morning","evening","nudges","weekly"]},enabled:{type:"boolean"}}));
  else if(type.endsWith("commitment")){
   for(const quote of quotes){const ids=commitmentActionTargets(quote,commitments,type).map(c=>c.id);if(ids.length)variants.push(object({...base,quote:{...str,enum:[quote]},commitment_id:{type:"string",enum:ids},due_at:{anyOf:[{type:"string"},{type:"null"}]}}));}
  }
  else {const ids=type==="correct_memory"?memoryIds:goalIds;if(ids.length&&(type!=="replace_goal"||goals.length))variants.push(object({...base,memory_id:{type:"string",enum:ids},...(type==="replace_goal"?{content:{type:"string",enum:goals}}:{})}));}
 }
 return {type:"array",items:variants.length?{anyOf:variants}:object({}),maxItems:variants.length?2:0};
}
export function validateAction(raw:unknown,message:string,commitments?:CoachCommitment[]):UserAction|null{
 if(!raw||typeof raw!=="object")return null;const a=raw as UserAction;
 if(typeof a.guidance!=="string"||a.guidance.length>600)return null;
 if(typeof a.quote!=="string"||a.quote.length<(a.type==="complete_commitment"?4:8)||!message.includes(a.quote)||!allowedActions(message).includes(a.type)||!allowedActions(a.quote).includes(a.type))return null;
 if(a.type==="track_commitment"&&(a.title!==a.quote||!trackingCommitmentCandidates(message).includes(a.quote)))return null;
 if(a.type==="report_commitment_outcome"&&a.outcome!==a.quote)return null;
 if(a.commitment_id&&(!commitments||!commitmentActionTargets(a.quote,commitments,a.type).some(c=>c.id===a.commitment_id)))return null;
 if(a.type==="replace_goal"&&(typeof a.content!=="string"||!replacementGoalCandidates(message).includes(a.content)))return null;
 const start=message.indexOf(a.quote);
 if([...message.matchAll(quotedText)].some(span=>start>=span.index&&start<span.index+span[0].length))return null;
 if(a.due_at && (!/^\d{4}-\d{2}-\d{2}/.test(a.due_at)||!message.includes(a.due_at.slice(0,10))))return null;
 if(a.type==="track_commitment"&&a.due_at&&(!message.includes(a.due_at)||!Number.isFinite(Date.parse(a.due_at))))return null;
 if(a.type==="cadence"){
  const wanted=/desative|pause|desligue|n[aã]o quero receber/iu.test(a.quote)?false:true;
  const match=a.kind==="morning"?/manh[aã]/iu:a.kind==="evening"?/fim do dia|final do dia|noite|fechamento/iu:a.kind==="weekly"?/semanal|semana/iu:/alerta|aviso|durante o dia/iu;
  if(a.enabled!==wanted||!match.test(a.quote))return null;
 }
 return a;
}

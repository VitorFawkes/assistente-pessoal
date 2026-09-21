import type {CoachMemory,CoachCommitment} from "./types";
const object=(properties:Record<string,unknown>)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const str={type:"string",minLength:1,maxLength:900};
export type UserAction={type:string;quote:string;memory_id?:string;commitment_id?:string;title?:string;due_at?:string|null;kind?:string;enabled?:boolean};
const normalized=(message:string)=>message.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().trim();
const quotedText=/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|‘[^’\n]*’|(?<!\S)'[^'\n]*'/gu;
const withoutQuotedText=(message:string)=>message.replace(quotedText,"TITULO_CITADO");
const requestPrefix=/^(?:(?:voce )?(?:pode|poderia)|(?:quero|preciso|gostaria) que (?:voce)?|(?:quero|preciso) (?:que )?voce)\s+/u;
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
 if(!hasDirectUserIntentContext(message))return [];
 const s=normalized(withoutQuotedText(message));
 // Negation before a mutation verb revokes permission. Negative task descriptions
 // ("crie uma tarefa para não esquecer") and explicit cadence opt-out stay valid.
 if(/\b(?:nao|nunca|jamais|nem|sem|evite|pare de|deixe de)\b[^.!?;\n]{0,90}\b(?:crie|cria|criar|registre|registra|registrar|adicione|adiciona|adicionar|anote|anotar|conclui|terminei|atingi|concluir|conclua|pause|pausar|ative|ativar|ligue|ligar|renegocie|reagende|mude|troque|substitua)\b/u.test(s))return [];
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
  if((!clause.endsWith("?")&&/^(?:eu )?(?:ja )?(?:conclui|terminei)\b/u.test(command))||/^marque como concluid/u.test(command)||(requested&&/^concluir\b/u.test(command)))a.add("complete_commitment");
  if(/^(?:eu )?(?:renegociei|reagendei|renegocie|reagende|mude o prazo)\b/u.test(command))a.add("renegotiate_commitment");
  if(/^(?:ative|desative|pause|ligue|desligue|quero receber|nao quero receber)\b.{0,90}\b(?:manha|dia|semanal|alerta|aviso|check.?in)/u.test(command))a.add("cadence");
 }
 return [...a];
}

export function actionSchema(message:string,memories:CoachMemory[],commitments:CoachCommitment[]){
 const allowed=allowedActions(message);const variants:unknown[]=[];
 const memoryIds=memories.filter(m=>m.status!=="rejected").map(m=>m.id);
 const goalIds=memories.filter(m=>m.kind==="goal"&&(m.lifecycle||"active")==="active").map(m=>m.id);
 for(const type of allowed){
  const base={type:{type:"string",enum:[type]},quote:str};
  if(type==="create_commitment")variants.push(object({...base,title:{type:"string",minLength:1,maxLength:300},due_at:{anyOf:[{type:"string"},{type:"null"}]}}));
  else if(type==="cadence")variants.push(object({...base,kind:{type:"string",enum:["morning","evening","nudges","weekly"]},enabled:{type:"boolean"}}));
  else if(type.endsWith("commitment")){if(commitments.length)variants.push(object({...base,commitment_id:{type:"string",enum:commitments.map(c=>c.id)},due_at:{anyOf:[{type:"string"},{type:"null"}]}}));}
  else {const ids=type==="correct_memory"?memoryIds:goalIds;if(ids.length)variants.push(object({...base,memory_id:{type:"string",enum:ids}}));}
 }
 return {type:"array",items:variants.length?{anyOf:variants}:object({}),maxItems:variants.length?2:0};
}
export function validateAction(raw:unknown,message:string):UserAction|null{
 if(!raw||typeof raw!=="object")return null;const a=raw as UserAction;
 if(typeof a.quote!=="string"||a.quote.length<8||!message.includes(a.quote)||!allowedActions(message).includes(a.type)||!allowedActions(a.quote).includes(a.type))return null;
 const start=message.indexOf(a.quote);
 if([...message.matchAll(quotedText)].some(span=>start>=span.index&&start<span.index+span[0].length))return null;
 if(a.due_at && (!/^\d{4}-\d{2}-\d{2}/.test(a.due_at)||!message.includes(a.due_at.slice(0,10))))return null;
 if(a.type==="cadence"){
  const wanted=/desative|pause|desligue|n[aã]o quero receber/iu.test(a.quote)?false:true;
  const match=a.kind==="morning"?/manh[aã]/iu:a.kind==="evening"?/fim do dia|final do dia|noite|fechamento/iu:a.kind==="weekly"?/semanal|semana/iu:/alerta|aviso|durante o dia/iu;
  if(a.enabled!==wanted||!match.test(a.quote))return null;
 }
 return a;
}

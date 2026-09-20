import type { CoachMemory } from "./types";
type UserMemory = Pick<CoachMemory,"kind"|"content"|"status"|"evidence">;

/** Save the user's own words, never the model's paraphrase, as a revisable self-report. */
export function userMemoryNotes(raw:unknown,message:string):UserMemory[]{
 if(!Array.isArray(raw))return [];
 const seen=new Set<string>();
 return raw.flatMap(value=>{
  if(!value||typeof value!=="object")return [];
  const {kind,quote}=value;
  if(!["goal","context","experiment"].includes(kind)||typeof quote!=="string")return [];
  const literal=quote.trim();
  if(literal.length<8||literal.length>900||!message.includes(literal)||userMemoryKind(literal)!==kind||seen.has(literal.toLocaleLowerCase("pt-BR")))return [];
  seen.add(literal.toLocaleLowerCase("pt-BR"));
  return [{kind,content:`Informado por você na conversa: ${literal}`,status:"confirmed" as const,evidence:[]}];
 }).slice(0,2);
}

/** Strict output enum prevents the provider from copying goals from another context as a new user statement. */
export function userMemoryCandidates(message:string):string[]{
 return [...new Set(message.split(/(?<=[.!?])\s+|\n+/u).map(s=>s.trim()).filter(s=>s.length>=8&&s.length<=900&&userMemoryKind(s)!==null))].slice(0,12);
}

/** Conservative admission: conversational requests and temporary task states are not durable self-descriptions. */
export function userMemoryKind(quote:string):"goal"|"context"|"experiment"|null{
 const s=quote.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().trim();
 if(s.endsWith("?")||/^(?:compare|me (?:fala|diga|ajude)|guarde esse|lembre esse|o que|como|pode |quero (?:que voce|uma resposta|conversar|saber|entender))\b/u.test(s))return null;
 if(/\b(?:voce entendeu errado|corrigindo|na verdade|nao foi isso|eu nao assumi|nao assumi a execucao)\b/u.test(s))return "context";
 if(/\b(?:meu objetivo|minha meta|minha prioridade|meu foco)\b/u.test(s)){
  if(/\b(?:era|foi|tinha|anterior)\b/u.test(s))return null;
  return "goal";
 }
 if(/^(?:eu )?(?:quero|preciso) (?:melhorar|desenvolver|aprender|priorizar|delegar|concluir|terminar|reduzir|focar|escolher|organizar|liderar)\b/u.test(s))return "goal";
 if(/^(?:eu )?(?:vou|decidi|me comprometo a) (?:pausar|delegar|concluir|terminar|limitar|registrar|revisar|confirmar|escolher|reservar|testar|priorizar)\b/u.test(s))return "experiment";
 if(/^(?:meu (?:contexto|papel)|minha (?:responsabilidade|dificuldade)|(?:eu )?(?:trabalho|lidero|coordeno|gerencio|tenho dificuldade))\b/u.test(s))return "context";
 return null;
}

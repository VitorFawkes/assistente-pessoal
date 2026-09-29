import { hasDirectUserIntentContext } from "./conversation-actions";
import type { CoachMemory } from "./types";
type UserMemory = Pick<CoachMemory,"kind"|"content"|"status"|"evidence">;

/** Save the user's own words, never the model's paraphrase, as a revisable self-report. */
export function userMemoryNotes(raw:unknown,message:string):UserMemory[]{
 if(!Array.isArray(raw)||!hasDirectUserIntentContext(message))return [];
 const candidates=new Set(userMemoryCandidates(message));
 const seen=new Set<string>();
 return raw.flatMap(value=>{
  if(!value||typeof value!=="object")return [];
  const {kind,quote}=value;
  if(!["goal","context","experiment"].includes(kind)||typeof quote!=="string")return [];
  const literal=quote.trim();
  if(literal.length<8||literal.length>900||!candidates.has(literal)||userMemoryKind(literal)!==kind||seen.has(literal.toLocaleLowerCase("pt-BR")))return [];
  seen.add(literal.toLocaleLowerCase("pt-BR"));
  return [{kind,content:`Informado por você na conversa: ${literal}`,status:"confirmed" as const,evidence:[]}];
 }).slice(0,2);
}

/** Strict output enum prevents the provider from copying goals from another context as a new user statement. */
export function userMemoryCandidates(message:string):string[]{
 if(!hasDirectUserIntentContext(message))return [];
 const parts=message.split(/(?<=[.!?])\s+|\n+/u).map(s=>s.trim()).filter(Boolean);
 // "Agora tenho 2 grandes objetivos" and the goals on the next line: the announcement joins what follows it.
 const bare=(part:string)=>GOAL_INTRO.test(plain(part))&&!plain(part).replace(GOAL_INTRO,"").replace(/[\s:.!-]+/gu,"");
 const announced=parts.flatMap((part,i)=>bare(part)&&parts[i+1]?[`${part.replace(/[\s:.!-]+$/u,"")}: ${parts[i+1]}`]:[]);
 return [...new Set([...announced,...parts.filter(part=>!bare(part))].filter(s=>s.length>=8&&s.length<=900&&userMemoryKind(s)!==null))].slice(0,12);
}
const plain=(s:string)=>s.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().trim();
/** Goals the user announces in so many words ("Agora tenho 2 grandes objetivos: …") are kept even when the model leaves them out. */
export function announcedGoals(message:string):UserMemory[]{
 return userMemoryCandidates(message).filter(quote=>GOAL_INTRO.test(plain(quote))).slice(0,2).map(quote=>({kind:"goal" as const,content:`Informado por você na conversa: ${quote}`,status:"confirmed" as const,evidence:[]}));
}
/** "Agora tenho 2 grandes objetivos", "tenho uma nova meta": the user announcing goals of their own. */
const GOAL_INTRO=/^(?:agora |hoje |a partir de agora )?(?:eu )?(?:tenho|temos) (?:(?:\d+|um|uma|dois|duas|tres|alguns|algumas) )?(?:(?:grandes?|nov[oa]s?|principais) )*(?:objetivos?|metas?)\b/u;

/** Conservative admission: conversational requests and temporary task states are not durable self-descriptions. */
export function userMemoryKind(quote:string):"goal"|"context"|"experiment"|null{
 if(!hasDirectUserIntentContext(quote))return null;
 const s=quote.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().trim();
 if(s.endsWith("?")||/^(?:compare|me (?:fala|diga|ajude)|guarde esse|lembre esse|o que|como|pode |quero (?:que voce|uma resposta|conversar|saber|entender))\b/u.test(s))return null;
 if(/\b(?:voce entendeu errado|corrigindo|na verdade|nao foi isso|eu nao assumi|nao assumi a execucao)\b/u.test(s))return "context";
 if(GOAL_INTRO.test(s))return "goal";
 if(/^(?:meu objetivo|minha meta|minha prioridade|meu foco)\b/u.test(s)){
  if(/\b(?:era|foi|tinha|anterior)\b/u.test(s))return null;
  return "goal";
 }
 if(/^(?:eu )?(?:quero|preciso) (?:melhorar|desenvolver|aprender|priorizar|delegar|concluir|terminar|reduzir|focar|escolher|organizar|liderar)\b/u.test(s))return "goal";
 if(/^(?:eu )?(?:vou|decidi|me comprometo a) (?:pausar|delegar|concluir|terminar|limitar|registrar|revisar|confirmar|escolher|reservar|testar|priorizar)\b/u.test(s))return "experiment";
 if(/^(?:meu (?:contexto|papel)|minha (?:responsabilidade|dificuldade)|(?:eu )?(?:trabalho|lidero|coordeno|gerencio|tenho dificuldade))\b/u.test(s))return "context";
 return null;
}

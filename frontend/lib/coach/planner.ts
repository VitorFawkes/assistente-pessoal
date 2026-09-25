import type { CoachJsonSchema } from "./provider-schema";
import { validCoachSchema } from "./provider-schema";
import { providerCompletion, type CoachTelemetry } from "./provider";
import { QUERY_KINDS, PERIODS } from "./assistant-types";
import type { MeetingCandidate, PersonCandidate, PlannedQuery, QueryKind, PeriodKey } from "./assistant-types";

/**
 * Instruction for the cheap model (papel 'quick' = gpt-6-luna) on which queries to run
 * based on the user's message. Guides the choice without exposing internals.
 */
export const PLANNER_INSTRUCTION = `Você escolhe quais buscas o servidor do app Ações faz para responder a mensagem do usuário. Não responda a mensagem: só escolha as buscas (no máximo 4, sem repetir).
lane "tarefas" = pergunta de informação: escolha o que traz a resposta completa. lane "coach" = conselho, preparação ou reflexão: escolha só o que muda o conselho; saudação, agradecimento ou desabafo sem assunto concreto = nenhuma busca.
Pessoas e reuniões só por ref (p0, r0...) de pessoas_citadas e reunioes_citadas. Nome citado com várias pessoas do mesmo primeiro nome: use a primeira da lista (já vem a mais provável). Campos que não se aplicam: "" em pessoa, reuniao, periodo e busca; campo "prazo", status "abertas", ordem "prazo".

Buscas:
- tarefas_da_pessoa (pessoa): tarefas em que a pessoa é responsável ou está envolvida. "o que falta com X" / "pendências da X" = status abertas, ordem prazo. "últimas tarefas que discuti com X" / "o que combinei com X" = status todas, ordem recentes.
- tarefas_por_assunto (busca): palavras-chave do assunto ("Active", "closer Curitiba"). Use para "quem ficou responsável por...", "tem tarefa sobre...". status todas quando perguntam se algo foi feito.
- tarefas_do_periodo (periodo, campo): campo prazo = vence no período; criacao = criadas no período; conclusao = concluídas no período (status todas).
- pendencias: o que vence hoje e o que está atrasado. "o que tenho hoje", "o que está atrasado", "meu dia" (junto com agenda).
- reunioes_da_pessoa (pessoa; periodo opcional): reuniões em que a pessoa falou ou de onde saíram tarefas ligadas a ela. "última reunião com X", "o que conversei com X".
- reunioes_por_assunto (busca; periodo opcional): reuniões em que um assunto apareceu.
- reunioes_do_periodo (periodo): reuniões gravadas no período ("reuniões de ontem", "o que gravei essa semana").
- detalhe_da_reuniao (reuniao): relatório, participantes e tarefas de uma reunião citada. Se só a data foi citada e há várias reuniões nesse dia, use reunioes_do_periodo ou escolha pelo assunto.
- trechos (busca; reuniao ou pessoa opcionais): fala literal da transcrição. Só quando importa o que foi dito exatamente, ou no coach, para ver como o usuário agiu.
- agenda (periodo opcional, padrão hoje): compromissos do calendário.
- conversas (busca): o que o usuário já conversou com o Coach sobre um assunto, em conversas antigas (as últimas mensagens já estão na conversa recente). "o que falamos sobre X", "aquilo que te contei de X".

Exemplos: "quais foram as últimas tarefas que discuti com a Ana" → tarefas_da_pessoa(p0, todas, recentes) + reunioes_da_pessoa(p0). "me ajuda a preparar a conversa com a Paula" (coach) → tarefas_da_pessoa(p0, abertas) + reunioes_da_pessoa(p0). "o que tenho hoje?" → pendencias + agenda(hoje).`;

/**
 * Generate JSON schema for the planner's output, parameterized by people and meetings.
 * Converts PersonCandidate and MeetingCandidate to short refs for enums.
 */
export function plannerSchema(people: PersonCandidate[], meetings: MeetingCandidate[]): CoachJsonSchema {
 const personRefs = ["", ...people.map((_, i) => `p${i}`)];
 const meetingRefs = ["", ...meetings.map((_, i) => `r${i}`)];
 const queryKindEnum = Array.from(QUERY_KINDS);
 const periodEnum = ["", ...PERIODS];

 const schema: CoachJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["consultas"],
  properties: {
   consultas: {
    type: "array",
    maxItems: 4,
    items: {
     type: "object",
     additionalProperties: false,
     required: ["tipo", "pessoa", "reuniao", "busca", "periodo", "campo", "status", "ordem"],
     properties: {
      tipo: { type: "string", enum: queryKindEnum },
      pessoa: { type: "string", enum: personRefs },
      reuniao: { type: "string", enum: meetingRefs },
      busca: { type: "string", maxLength: 120 },
      periodo: { type: "string", enum: periodEnum },
      campo: { type: "string", enum: ["prazo", "criacao", "conclusao"] },
      status: { type: "string", enum: ["abertas", "todas"] },
      ordem: { type: "string", enum: ["recentes", "prazo"] },
     },
    },
   },
  },
 };

 if (!validCoachSchema(schema)) throw new Error("Invalid planner schema");
 return schema;
}

/**
 * Plan which queries to run based on the user's message and context.
 * Calls the cheap model (gpt-6-luna, papel 'quick') to choose.
 */
export async function planQueries(input: {
 message: string;
 recent: { role: string; content: string }[];
 people: PersonCandidate[];
 meetings: MeetingCandidate[];
 lane: "tarefas" | "coach";
 timezone: string;
 now: Date;
 onTelemetry?: (e: CoachTelemetry) => void;
}): Promise<PlannedQuery[]> {
 const data = {
  now_local: new Intl.DateTimeFormat("pt-BR", {
   timeZone: input.timezone,
   dateStyle: "full",
   timeStyle: "short",
  }).format(input.now),
  lane: input.lane,
  mensagem: input.message.slice(0, 1000),
  conversa_recente: input.recent
   .slice(-4)
   .map(m => ({
    role: m.role,
    conteudo: m.content.length > 400 ? m.content.slice(0, 397) + "…" : m.content,
   })),
  pessoas_citadas: input.people.map((p, i) => ({
   ref: `p${i}`,
   nome: p.nome,
   tarefas: p.tarefas,
   ultima_reuniao: p.ultima_reuniao,
  })),
  reunioes_citadas: input.meetings.map((m, i) => ({
   ref: `r${i}`,
   titulo: m.titulo,
   data: m.recorded_at,
  })),
 };

 const schema = plannerSchema(input.people, input.meetings);

 try {
  const raw = await providerCompletion(PLANNER_INSTRUCTION, data, schema, {
   role: "quick",
   reasoningEffort: "low",
   timeoutMs: 30000,
   onTelemetry: input.onTelemetry,
  });

  const consultas = Array.isArray(raw.consultas) ? raw.consultas : [];

  // Map refs to ids, validate required params, deduplicate
  const refMap = new Map(input.people.map((p, i) => [`p${i}`, p.id]));
  const meetingMap = new Map(input.meetings.map((m, i) => [`r${i}`, m.id]));

  const planned = consultas
   .map(q => normalizeQuery(q as Record<string, unknown>, refMap, meetingMap))
   .filter((q): q is PlannedQuery => {
    // Discard queries missing required parameters
    if (!isValidQuery(q)) return false;
    return true;
   });

  // Remove exact duplicates (the same lookup with another status or order is a different lookup)
  const seen = new Set<string>();
  const unique = planned.filter(q => {
   const key = `${q.tipo}:${q.pessoa}:${q.reuniao}:${q.busca}:${q.periodo}:${q.campo}:${q.status}:${q.ordem}`;
   if (seen.has(key)) return false;
   seen.add(key);
   return true;
  });

  if (!unique.length && input.lane === "tarefas") return defaultPlan(input.people, input.meetings, input.lane);
  return unique.slice(0, 4);
 } catch {
  // On error, use deterministic fallback
  return defaultPlan(input.people, input.meetings, input.lane);
 }
}

/**
 * Convert refs to ids and ensure all fields are present.
 */
function normalizeQuery(
 q: Record<string, unknown>,
 refMap: Map<string, string>,
 meetingMap: Map<string, string>,
): Partial<PlannedQuery> {
 const tipo = q.tipo as string;
 const pessoa = q.pessoa ? (refMap.get(q.pessoa as string) ?? null) : null;
 const reuniao = q.reuniao ? (meetingMap.get(q.reuniao as string) ?? null) : null;
 const busca = String(q.busca ?? "").slice(0, 120);
 const periodo = (q.periodo as string) || null;
 const campo = q.campo as string;
 const status = q.status as string;
 const ordem = q.ordem as string;

 return { tipo: tipo as QueryKind, pessoa, reuniao, busca, periodo: periodo as PeriodKey | null, campo: campo as "prazo" | "criacao" | "conclusao", status: status as "abertas" | "todas", ordem: ordem as "recentes" | "prazo" };
}

/**
 * Validate that a query has the required parameters for its type.
 */
function isValidQuery(q: Partial<PlannedQuery>): q is PlannedQuery {
 if (!q.tipo) return false;

 switch (q.tipo) {
  case "tarefas_da_pessoa":
  case "reunioes_da_pessoa":
   return !!q.pessoa;
  case "tarefas_por_assunto":
  case "reunioes_por_assunto":
  case "trechos":
  case "conversas":
   return !!q.busca;
  case "tarefas_do_periodo":
   return !!q.periodo && !!q.campo && !!q.status && !!q.ordem;
  case "reunioes_do_periodo":
   return !!q.periodo;
  case "detalhe_da_reuniao":
   return !!q.reuniao;
  case "pendencias":
  case "agenda":
   return true;
  default:
   return false;
 }
}

const query = (tipo: QueryKind, extra: Partial<PlannedQuery> = {}): PlannedQuery => ({ tipo, pessoa: null, reuniao: null, busca: "", periodo: null, campo: "prazo", status: "abertas", ordem: "prazo", ...extra });

/**
 * Fallback when the model fails, or finds nothing to look up for an information question: what the message cites
 * (already matched by the server); else, for an information question, today's due and overdue tasks.
 */
export function defaultPlan(people: PersonCandidate[], meetings: MeetingCandidate[], lane: "tarefas" | "coach"): PlannedQuery[] {
 if (meetings[0]) return [query("detalhe_da_reuniao", { reuniao: meetings[0].id })];
 if (people[0]) return [query("tarefas_da_pessoa", { pessoa: people[0].id, status: "todas", ordem: "recentes" }), query("reunioes_da_pessoa", { pessoa: people[0].id })];
 return lane === "tarefas" ? [query("pendencias")] : [];
}

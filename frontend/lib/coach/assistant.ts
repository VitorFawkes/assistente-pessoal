import type { Dossier, PlannedQuery } from "./assistant-types";
import { slimForModel } from "./context-budget";
import { localContextDates } from "./context-dates";
import { resolveEntities, runQueries } from "./finder";
import { planQueries } from "./planner";
import { providerCompletion, type CoachTelemetry } from "./provider";

/**
 * The assistant finds what a message needs: the cheap model picks the lookups (planner), the server runs fixed
 * queries (finder) and the result is a dossier. Information questions are answered from it by the cheap model;
 * coaching reads the same dossier instead of a large package.
 */
type Recent = { role: string; content: string }[];

export async function buildDossier(input: { userId: string; message: string; recent: Recent; lane: "tarefas" | "coach"; timezone: string; now: Date; selfPersonIds: string[]; onTelemetry?: (e: CoachTelemetry) => void }): Promise<Dossier> {
 const resolve = (text: string) => resolveEntities(input.userId, text, { timezone: input.timezone, now: input.now }).catch(() => ({ people: [], meetings: [] }));
 let { people, meetings } = await resolve(input.message);
 // A follow-up ("e as reuniões?") cites no one: use who the user's previous messages cited.
 const previous = input.recent.filter(m => m.role === "user").slice(-2).map(m => m.content).join("\n");
 if (!people.length && !meetings.length && previous) ({ people, meetings } = await resolve(previous));
 const queries = await planQueries({ message: input.message, recent: input.recent, people, meetings, lane: input.lane, timezone: input.timezone, now: input.now, onTelemetry: input.onTelemetry });
 return runQueries(input.userId, queries, { timezone: input.timezone, now: input.now, selfPersonIds: input.selfPersonIds, people, meetings });
}

const q = (tipo: PlannedQuery["tipo"], extra: Partial<PlannedQuery> = {}): PlannedQuery => ({ tipo, pessoa: null, reuniao: null, busca: "", periodo: null, campo: "prazo", status: "abertas", ordem: "prazo", ...extra });

/** Scheduled check-ins always need the same data, so no model plans them. */
export function proactivePlan(kind: "morning" | "evening" | "nudge" | "meeting", meetingId?: string): PlannedQuery[] {
 if (kind === "morning") return [q("pendencias"), q("agenda", { periodo: "hoje" }), q("reunioes_do_periodo", { periodo: "ontem" })];
 if (kind === "evening") return [q("agenda", { periodo: "hoje" }), q("reunioes_do_periodo", { periodo: "hoje" }), q("tarefas_do_periodo", { periodo: "hoje", campo: "conclusao", status: "todas" })];
 if (kind === "meeting" && meetingId) return [q("detalhe_da_reuniao", { reuniao: meetingId })];
 return [q("pendencias")];
}

export async function proactiveDossier(input: { userId: string; kind: "morning" | "evening" | "nudge" | "meeting"; meetingId?: string; timezone: string; now: Date; selfPersonIds: string[] }): Promise<Dossier> {
 return runQueries(input.userId, proactivePlan(input.kind, input.meetingId), { timezone: input.timezone, now: input.now, selfPersonIds: input.selfPersonIds, people: [] });
}

const DATE_KEYS = new Set(["prazo", "criada_em", "concluida_em", "data", "ultima_reuniao", "recorded_at"]);
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * What a model may read: dates already in the user's timezone (a UTC date can fall on the next day), and the
 * transcript chunks behind passages stay on the server.
 */
export function dossierForModel(dossier: Dossier, timezone: string) {
 const format = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
 const local = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(local);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, DATE_KEYS.has(k) && typeof v === "string" && iso.test(v) && Number.isFinite(Date.parse(v)) ? format.format(new Date(v)) : local(v)]));
 };
 const { excerpts: _excerpts, ...rest } = dossier;
 void _excerpts;
 return local(rest) as Omit<Dossier, "excerpts">;
}

export const ASSISTANT_INSTRUCTION = `Você é o assistente do app Ações: acha e resume para o usuário o que está registrado sobre tarefas, pessoas, reuniões, prazos e agenda. Responda curto e direto, em português do Brasil.
Use só o que está em assistant_dossier e em recent_conversation. Cada consulta do dossiê diz o que foi buscado, quantos existem (total) e quantos vieram (mostrados). Não invente tarefas, reuniões, decisões, datas, responsáveis nem status. Se o dossiê não traz o que foi perguntado, diga o que não achou.
Liste o que foi pedido de forma completa: se total for maior que mostrados, diga quantos há no total. Cite datas no formato dia/mês e, para reuniões, a data e o título.
pessoas_citadas traz as pessoas do cadastro com o nome citado; se houver mais de uma com o mesmo primeiro nome, responda sobre a que o dossiê usou e diga que existem as outras.
Em tarefas, ligacao "responsavel" = a pessoa é a dona; "envolvida" = aparece na tarefa, que é de outra pessoa (diga de quem). Em reuniões, ligacao "participou" = a voz da pessoa foi identificada na gravação; "tarefas_ligadas" = não foi identificada falando, mas saíram dali tarefas que a envolvem. Para "última reunião com X", prefira a mais recente em que participou e diga se houve depois outra só com tarefas ligadas. participantes lista só as vozes identificadas; pode faltar gente.
Resumo de reunião é relatório gerado pelo Ações, não fala literal: atribua como "segundo o relatório".
already_done_by_server traz mudanças já feitas ou uma pergunta já feita pelo servidor nesta mesma mensagem: não repita nem contradiga. Você não altera tarefas; mudanças são feitas quando o usuário pede claramente ("concluí X", "adia Y para sexta").
Para revisar ou limpar uma lista, cite os títulos (agrupe por assunto quando passar de 8) e pergunte quais já foram feitas, quais perderam o sentido e quais seguem.
Agenda com agenda_status diferente de "connected" é agenda que não foi lida: nunca diga que está vazia.
Não dê conselho nem opinião sobre o que priorizar; se o usuário pedir, responda o que é informação e diga que pode pensar a prioridade com ele.
Nunca mostre ids ou códigos internos.`;

export const assistantSchema = { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string", minLength: 1, maxLength: 3500 } } };

const clip = (s: string, max: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };

export async function answerInfo(input: { message: string; recent: Recent; notes: string[]; dossier: Dossier; timezone: string; now: Date; onTelemetry?: (e: CoachTelemetry) => void }) {
 const data = {
  now_local: new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone, dateStyle: "full", timeStyle: "short" }).format(input.now),
  timezone: input.timezone,
  message: input.message,
  ...(input.notes.length ? { already_done_by_server: input.notes } : {}),
  recent_conversation: input.recent.slice(-6).map(m => ({ role: m.role, text: clip(m.content, 600) })),
  assistant_dossier: dossierForModel(input.dossier, input.timezone),
 };
 const raw = await providerCompletion(ASSISTANT_INSTRUCTION, slimForModel(localContextDates(data, input.timezone)), assistantSchema, { role: "quick", reasoningEffort: "low", timeoutMs: 90000, onTelemetry: input.onTelemetry });
 return String(raw.answer).trim();
}

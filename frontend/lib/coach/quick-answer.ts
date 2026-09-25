import { calendarContext } from "./calendar";
import { slimForModel } from "./context-budget";
import { localContextDates } from "./context-dates";
import { dueTasks, localDayRange } from "./morning-agenda";
import { providerCompletion, type CoachTelemetry } from "./provider";
import { candidateTasks, type CandidateTask } from "./task-actions";

/**
 * Cheap lane for operational messages about tasks, deadlines and agenda: a small package, the cheap model
 * (role "quick") and no verifier. Coaching (advice, priorities, goals) keeps the full, verified answer.
 */
export const QUICK_INSTRUCTION = `Você é o assistente de tarefas do app Ações. Responde pedidos e perguntas operacionais sobre tarefas, prazos, pendências e agenda, curto e direto, em português do Brasil.
Use só os dados fornecidos: due_tasks, related_tasks, agenda_today e recent_conversation. Não invente tarefas, prazos, responsáveis nem status; se faltar dado, diga o que falta.
already_done_by_server traz mudanças já feitas ou uma pergunta já feita pelo servidor nesta mesma mensagem: não repita nem contradiga.
Você não altera tarefas: o servidor altera quando o usuário pede claramente ("concluí X", "adia Y para sexta"). Se ele quer marcar várias como feitas, peça que diga quais, citando os títulos.
Para revisar ou limpar uma lista, cite as tarefas pelo título (agrupe por assunto quando passar de 8) e pergunte quais já foram feitas, quais perderam o sentido e quais seguem.
due_tasks traz, na ordem da mensagem das 8h, o que vence hoje e o que está atrasado; shown_at_8h marca as que a mensagem das 8h já mostrou ("Mais N no Ações" são as demais).
Não dê conselho de coaching nem opinião sobre o que priorizar; se o usuário pedir isso, responda o operacional e diga que pode pensar a prioridade com ele.
Se agenda_today.status não for "connected", diga que não conseguiu ler a agenda agora; nunca diga que a agenda está vazia.
Nunca mostre ids ou códigos internos. Datas no formato dia/mês.`;

export const quickSchema = { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string", minLength: 1, maxLength: 3000 } } };

type Due = Awaited<ReturnType<typeof dueTasks>>;
const clip = (s: string, max: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };

/** Everything the cheap model reads; bounded and free of internal ids. */
type AgendaEvent = { subject: string; start: string; end: string; start_local?: string; end_local?: string; is_all_day?: boolean; is_private?: boolean };
export function quickData(input: { message: string; history: { role: string; content: string }[]; notes: string[]; timezone: string; now: Date; due: Due | null; tasks: CandidateTask[]; agenda: { status: string; events: AgendaEvent[] } }) {
 const open = input.tasks.filter(t => t.status !== "concluida" && t.status !== "cancelada");
 const closed = input.tasks.filter(t => !open.includes(t));
 return {
  now_local: new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone, dateStyle: "full", timeStyle: "short" }).format(input.now),
  timezone: input.timezone,
  message: input.message,
  ...(input.notes.length ? { already_done_by_server: input.notes } : {}),
  recent_conversation: input.history.slice(-6).map(m => ({ role: m.role, text: clip(m.content, 600) })),
  ...(input.due ? { due_tasks: { ...input.due, items: input.due.items.map(i => ({ titulo: i.titulo, owner: i.owner, acao: i.acao, prazo: i.prazo, vence_hoje: i.vence_hoje, shown_at_8h: i.shown_at_8h })) } } : {}),
  related_tasks: [...open, ...closed].slice(0, 40).map(t => ({ titulo: clip(t.titulo, 160), owner: t.owner, status: t.status, prazo: t.prazo, prioridade: t.prioridade })),
  // A failed read is not an empty day: the status tells them apart.
  agenda_today: { status: input.agenda.status, events: input.agenda.events.slice(0, 15).map(e => ({ subject: e.is_private ? "Compromisso particular" : e.subject, start: e.start, end: e.end, ...(e.start_local ? { start_local: e.start_local } : {}), ...(e.end_local ? { end_local: e.end_local } : {}), ...(e.is_all_day ? { is_all_day: true } : {}) })) },
 };
}

export async function quickTaskAnswer(input: { userId: string; message: string; history: { role: string; content: string }[]; notes: string[]; timezone: string; now: Date; onTelemetry?: (event: CoachTelemetry) => void }) {
 const range = localDayRange(input.timezone, input.now);
 const [due, tasks, agenda] = await Promise.all([
  dueTasks(input.userId, input.timezone, input.now, 40).catch(() => null),
  candidateTasks(input.userId, input.message).catch(() => []),
  calendarContext(input.userId, { from: range.from.toISOString(), to: range.to.toISOString() }, { timezone: input.timezone }).then(c => ({ status: c.status, events: c.events })).catch(() => ({ status: "unavailable", events: [] })),
 ]);
 const data = quickData({ ...input, due, tasks, agenda });
 const raw = await providerCompletion(QUICK_INSTRUCTION, slimForModel(localContextDates(data, input.timezone)), quickSchema, { role: "quick", reasoningEffort: "low", timeoutMs: 90000, onTelemetry: input.onTelemetry });
 return String(raw.answer).trim();
}

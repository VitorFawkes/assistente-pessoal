import { splitChatPresentation } from "./chat-presentation";
import type { CalendarContext } from "./calendar";
import type { CoachTask, CoachTaskEvent, TaskSelection } from "./task-context";
import type { CoachMessage, CoachReview } from "./types";

/**
 * What one model call reads. Every call re-sends this package (and the verifier reads it again),
 * so it carries what helps the answer and the model reads the rest on demand with its tools.
 * The server keeps the full records for lineage, validation and display.
 */
export const MODEL_CONTEXT = {
 history: 12, historyChars: 1500,
 retrieved: 4, retrievedChars: 600,
 tasks: 40, taskDescriptionChars: 200,
 events: 20, eventPayloadChars: 200,
 meetings: 10, reportChars: 16000,
 historicalMeetings: 6, historicalReportChars: 6000,
 reviews: 1, reviewFieldChars: 800,
 calendarEvents: 30,
 toolReportChars: 12000, toolExcerptChars: 4000, toolTasks: 25, toolEvents: 10,
 weeklyReportChars: 36000, weeklyPreviousReviews: 3,
} as const;

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** A past message as the model needs it: who said what, when, and whether its context still holds. */
export function modelMessages(messages: CoachMessage[], limit: number, maxChars: number) {
 return messages.slice(-limit).map(m => ({
  role: m.role,
  content: clip(m.role === "assistant" ? splitChatPresentation(m.content).answer : m.content, maxChars),
  created_at: m.created_at,
  ...(m.context_freshness ? { context_freshness: m.context_freshness } : {}),
  ...(m.context_periods?.length ? { context_periods: m.context_periods.map(p => ({ from: p.from, to: p.to })) } : {}),
 }));
}

/** Older messages found by the search, minus the ones already in the recent history. */
export function modelRetrieved(retrieved: CoachMessage[], history: CoachMessage[]) {
 const recent = new Set(history.map(m => m.id));
 return modelMessages(retrieved.filter(m => !recent.has(m.id)).slice(0, MODEL_CONTEXT.retrieved), MODEL_CONTEXT.retrieved, MODEL_CONTEXT.retrievedChars);
}

export function modelTasks(tasks: CoachTask[], limit: number = MODEL_CONTEXT.tasks) {
 return tasks.slice(0, limit).map(t => ({
  id: t.id, titulo: t.titulo,
  ...(t.descricao ? { descricao: clip(t.descricao, MODEL_CONTEXT.taskDescriptionChars) } : {}),
  owner: t.owner, is_mine: t.is_mine, acao: t.acao, status: t.status, prioridade: t.prioridade,
  prazo: t.prazo,
  ...(t.frentes?.length ? { frentes: t.frentes.map(f => f.nome) } : t.frente ? { frentes: [t.frente] } : {}),
  ...(t.meeting_id ? { meeting_id: t.meeting_id } : {}),
  ...(t.concluida_em ? { concluida_em: t.concluida_em } : {}),
  ...(t.cancelada_em ? { cancelada_em: t.cancelada_em } : {}),
  updated_at: t.updated_at,
  context_reasons: t.context_reasons,
 }));
}

export function modelEvents(events: CoachTaskEvent[], limit: number = MODEL_CONTEXT.events) {
 return events.slice(0, limit).map(e => {
  const payload = e.payload == null ? "" : JSON.stringify(e.payload);
  return { tarefa_id: e.tarefa_id, tarefa_titulo: e.tarefa_titulo, evento: e.evento, ...(payload && payload !== "{}" ? { detalhe: clip(payload, MODEL_CONTEXT.eventPayloadChars) } : {}), created_at: e.created_at };
 });
}

export function modelTaskSelection(selection: TaskSelection, tasksSent: number, eventsSent: number, limits: { tasks: number; events: number } = MODEL_CONTEXT) {
 return { ...selection, tasks_selected: tasksSent, events_selected: eventsSent, task_limit: limits.tasks, event_limit: limits.events };
}

/** A task read answers its query: matching tasks come before the open priorities the base package already has. */
export function queryFirst(tasks: CoachTask[]) {
 const matches = (t: CoachTask) => t.context_reasons?.includes("query_match");
 return [...tasks.filter(matches), ...tasks.filter(t => !matches(t))];
}

/** The latest weekly review in its own words, without evidence bookkeeping. */
export function modelReviews(reviews: CoachReview[], limit: number = MODEL_CONTEXT.reviews) {
 const field = (value: unknown) => clip(typeof value === "string" ? value : "", MODEL_CONTEXT.reviewFieldChars);
 return reviews.slice(0, limit).map(r => ({
  week_start: r.week_start, created_at: r.created_at,
  headline: field(r.content.headline), focus: field(r.content.focus), progress: field(r.content.progress),
  experiment: field(r.content.experiment), question: field(r.content.question),
 }));
}

/** Planned events only: subject and time, without the calendar's internal ids. */
export function modelCalendar(calendar: CalendarContext) {
 const events = Array.isArray(calendar.events) ? calendar.events : [];
 return {
  ...calendar,
  events: events.slice(0, MODEL_CONTEXT.calendarEvents).map(e => ({
   subject: e.subject, start: e.start, end: e.end,
   ...(e.start_local ? { start_local: e.start_local } : {}), ...(e.end_local ? { end_local: e.end_local } : {}),
   show_as: e.show_as, ...(e.is_all_day ? { is_all_day: true } : {}), ...(e.is_private ? { is_private: true } : {}),
  })),
  ...(events.length > MODEL_CONTEXT.calendarEvents ? { events_omitted: events.length - MODEL_CONTEXT.calendarEvents } : {}),
 };
}

/** Internal bookkeeping the model never uses: lineage hashes, owner ids and versions. */
const INTERNAL_KEYS = new Set(["context_sources", "context_hash", "content_hash", "source_hash", "fingerprint", "user_id", "context_version", "stale"]);
/** Record timestamps whose local twin says the same thing. Period bounds and "now" keep their ISO form for tool arguments. */
const LOCAL_TWIN = /^(?:prazo|start|end|.+_at)$/;

/**
 * Last pass over everything a model call reads (context and tool results), after dates get their
 * local form: drops internal bookkeeping and the UTC copy of each date that has a local twin.
 */
export function slimForModel(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
 if (!value || typeof value !== "object") return value;
 // A cycle stays a cycle, so serialization still fails safely in the provider.
 if (seen.has(value)) return seen.get(value);
 if (Array.isArray(value)) { const out: unknown[] = []; seen.set(value, out); for (const item of value) out.push(slimForModel(item, seen)); return out; }
 const row = value as Record<string, unknown>;
 const out: Record<string, unknown> = {};
 seen.set(value, out);
 for (const [key, item] of Object.entries(row)) {
  if (INTERNAL_KEYS.has(key)) continue;
  if (LOCAL_TWIN.test(key) && typeof item === "string" && typeof row[`${key}_local`] === "string") continue;
  out[key] = slimForModel(item, seen);
 }
 return out;
}

import { fromZonedTime } from "date-fns-tz";
import { withTenant } from "../db";
import { acoesUrl } from "../public-url";
import { calendarContext } from "./calendar";
import { tarefasDeOutros } from "./equipe";
import type { CalendarEvent } from "./calendar-types";

export type AgendaTask = { titulo: string; owner: string | null; acao: string | null; is_mine: boolean; prazo: string; today: boolean };
export type AgendaTotals = { today: number; overdue: number };
/** The morning list stays short; everything else is one link away. */
export const AGENDA_LIMIT = 5;

const localDate = (timezone: string, d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export function localDayRange(timezone: string, now: Date) {
 const today = localDate(timezone, now);
 const next = new Date(`${today}T12:00:00Z`);
 next.setUTCDate(next.getUTCDate() + 1);
 return { from: fromZonedTime(`${today}T00:00:00`, timezone), to: fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, timezone) };
}
const clip = (s: string, max: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };

/** Tasks due today first, then the most recently overdue (own tasks before follow-ups on the same day); at most AGENDA_LIMIT. */
export function agendaText(tasks: AgendaTask[], totals: AgendaTotals, events: Pick<CalendarEvent, "subject" | "start" | "is_all_day" | "is_private">[], timezone: string): string {
 const blocks: string[] = [];
 if (tasks.length) {
  const shown = tasks.slice(0, AGENDA_LIMIT);
  const date = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" });
  const lines = shown.map(t => {
   // "vitor"/"eu" (or no owner) marks the user; a follow-up only names someone else.
   const other = t.owner?.trim() && !/^(?:vitor|eu)\b/i.test(t.owner.trim()) ? t.owner.trim() : null;
   const who = t.acao === "cobrar" && !t.is_mine && other ? `Cobrar ${other}: ` : "";
   return `- ${who}${clip(t.titulo, 110)} (${t.today ? "vence hoje" : `venceu em ${date.format(new Date(t.prazo))}`})`;
  });
  const today = Math.max(0, totals.today - shown.filter(t => t.today).length);
  const overdue = Math.max(0, totals.overdue - shown.filter(t => !t.today).length);
  const rest = today + overdue;
  if (rest) {
   const parts = [today ? `${today} para hoje` : "", overdue ? `${overdue} ${overdue === 1 ? "atrasada" : "atrasadas"}` : ""].filter(Boolean).join(", ");
   lines.push(`Mais ${rest} no Ações (${parts}): ${acoesUrl("/")}`);
  }
  blocks.push(["**Para hoje**", ...lines].join("\n"));
 }
 if (events.length) {
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  const lines = [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 8)
   .map(e => `- ${e.is_all_day ? "Dia inteiro:" : time.format(new Date(e.start))} ${e.is_private ? "Compromisso particular" : clip(e.subject || "Compromisso", 90)}`);
  if (events.length > 8) lines.push(`- e mais ${events.length - 8} na agenda`);
  blocks.push(["**Agenda de hoje**", ...lines].join("\n"));
 }
 return blocks.join("\n\n");
}

type DueRow = { id: string; titulo: string; owner: string | null; acao: string | null; is_mine: boolean; prazo: Date; prioridade: string | null };
const RANK: Record<string, number> = { urgente: 0, alta: 1, media: 2 };
const rank = (p: string | null) => RANK[p ?? ""] ?? 3;

/** The ordering of the 8h list: due today first (by priority, then time), then the most recently overdue, own tasks before follow-ups. */
function agendaOrder(from: Date, timezone: string) {
 const day = (d: Date) => localDate(timezone, d);
 return (a: DueRow, b: DueRow) => {
  const ta = a.prazo >= from, tb = b.prazo >= from;
  if (ta !== tb) return ta ? -1 : 1;
  if (ta) return rank(a.prioridade) - rank(b.prioridade) || a.prazo.getTime() - b.prazo.getTime() || (a.is_mine === b.is_mine ? 0 : a.is_mine ? -1 : 1) || a.id.localeCompare(b.id);
  return day(b.prazo).localeCompare(day(a.prazo)) || (a.is_mine === b.is_mine ? 0 : a.is_mine ? -1 : 1) || rank(a.prioridade) - rank(b.prioridade) || b.prazo.getTime() - a.prazo.getTime() || a.id.localeCompare(b.id);
 };
}

/** Open tasks due today or overdue that the 8h list counts (own and follow-ups), including the ones colleagues handed to the user. */
async function dueRows(userId: string, timezone: string, now: Date) {
 const range = localDayRange(timezone, now);
 const own = await withTenant(userId, async db => (await db.query<DueRow>(
  `SELECT id,titulo,owner,acao,is_mine,prazo,prioridade FROM tarefas
   WHERE user_id=$1 AND status NOT IN ('concluida','cancelada') AND prazo IS NOT NULL AND prazo<$2 AND (is_mine OR acao='cobrar')`, [userId, range.to.toISOString()])).rows);
 const others: DueRow[] = (await tarefasDeOutros(userId))
  .filter(t => !["concluida", "cancelada"].includes(t.status) && t.prazo && new Date(t.prazo) < range.to && (t.is_mine || t.acao === "cobrar"))
  .map(t => ({ id: t.id, titulo: t.titulo, owner: t.owner, acao: t.acao, is_mine: t.is_mine, prazo: new Date(t.prazo!), prioridade: t.prioridade }));
 const rows = [...own.map(r => ({ ...r, prazo: new Date(r.prazo) })), ...others].sort(agendaOrder(range.from, timezone));
 return { rows, range, today: rows.filter(r => r.prazo >= range.from).length };
}

/** The tasks the 8h list counts, by name and in its order, so the Coach can go through "Mais N no Ações". */
export async function dueTasks(userId: string, timezone: string, now = new Date(), limit = 30) {
 const { rows, range, today } = await dueRows(userId, timezone, now);
 // The rest of the same list, so "what is open?" is not answered with only what is due.
 const rest = await withTenant(userId, async db => (await db.query<{ no_due: number; later: number }>(
  `SELECT (count(*) FILTER (WHERE prazo IS NULL))::int AS no_due,(count(*) FILTER (WHERE prazo>=$2))::int AS later
   FROM tarefas WHERE user_id=$1 AND status NOT IN ('concluida','cancelada') AND (is_mine OR acao='cobrar')`, [userId, range.to.toISOString()])).rows[0]);
 const others = (await tarefasDeOutros(userId)).filter(t => !["concluida", "cancelada"].includes(t.status) && (t.is_mine || t.acao === "cobrar"));
 const total = rows.length;
 const listed = rows.slice(0, limit);
 return {
  due_today: today, overdue: total - today, listed: listed.length,
  no_due: (rest?.no_due ?? 0) + others.filter(t => !t.prazo).length, later: (rest?.later ?? 0) + others.filter(t => t.prazo && new Date(t.prazo) >= range.to).length,
  note: `A lista das 8h mostra as ${Math.min(AGENDA_LIMIT, total)} primeiras (shown_at_8h); "Mais N no Ações" são as demais, na mesma ordem.`,
  items: listed.map((r, i) => ({ id: r.id, titulo: clip(r.titulo, 160), owner: r.owner, acao: r.acao, prazo: r.prazo.toISOString(), vence_hoje: r.prazo >= range.from, shown_at_8h: i < AGENDA_LIMIT })),
 };
}

/** Deterministic part of the 8h check-in: the user's own tasks and follow-ups due today or overdue, plus today's calendar. */
export async function morningAgenda(userId: string, timezone: string, now = new Date()): Promise<string> {
 const { rows, range, today } = await dueRows(userId, timezone, now);
 const events = await calendarContext(userId, { from: range.from.toISOString(), to: range.to.toISOString() }, { timezone }).then(c => c.events).catch(() => []);
 const shown = rows.slice(0, AGENDA_LIMIT).map(r => ({ titulo: r.titulo, owner: r.owner, acao: r.acao, is_mine: r.is_mine, prazo: r.prazo.toISOString(), today: r.prazo >= range.from }));
 return agendaText(shown, { today, overdue: rows.length - today }, events, timezone);
}

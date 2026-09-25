import { fromZonedTime } from "date-fns-tz";
import { withTenant } from "../db";
import { acoesUrl } from "../public-url";
import { calendarContext } from "./calendar";
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
   // "vitor" (or no owner) is the legacy marker for the user; a follow-up only names someone else.
   const other = t.owner?.trim() && !/^vitor\b/i.test(t.owner.trim()) ? t.owner.trim() : null;
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

/** The ordering of the 8h list: due today first, then the most recently overdue, own tasks before follow-ups. */
const AGENDA_ORDER = `prazo>=$2 DESC,
    CASE WHEN prazo>=$2 THEN CASE prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END END,
    CASE WHEN prazo>=$2 THEN prazo END,CASE WHEN prazo<$2 THEN (prazo AT TIME ZONE $4)::date END DESC,is_mine DESC,
    CASE prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,prazo DESC,id`;

/** The tasks the 8h list counts, by name and in its order, so the Coach can go through "Mais N no Ações". */
export async function dueTasks(userId: string, timezone: string, now = new Date(), limit = 30) {
 const range = localDayRange(timezone, now);
 const rows = await withTenant(userId, async db => (await db.query<{ id: string; titulo: string; owner: string | null; acao: string | null; prazo: Date; today: boolean; total: number; total_today: number }>(
  `SELECT id,titulo,owner,acao,prazo,prazo>=$2 AS today,count(*) OVER ()::int AS total,(count(*) FILTER (WHERE prazo>=$2) OVER ())::int AS total_today
   FROM tarefas WHERE user_id=$1 AND status NOT IN ('concluida','cancelada') AND prazo IS NOT NULL AND prazo<$3 AND (is_mine OR acao='cobrar')
   ORDER BY ${AGENDA_ORDER} LIMIT $5`, [userId, range.from.toISOString(), range.to.toISOString(), timezone, limit])).rows);
 const total = rows[0]?.total ?? 0, today = rows[0]?.total_today ?? 0;
 return {
  due_today: today, overdue: total - today, listed: rows.length,
  note: `A lista das 8h mostra as ${Math.min(AGENDA_LIMIT, total)} primeiras (shown_at_8h); "Mais N no Ações" são as demais, na mesma ordem.`,
  items: rows.map((r, i) => ({ id: r.id, titulo: clip(r.titulo, 160), owner: r.owner, acao: r.acao, prazo: new Date(r.prazo).toISOString(), vence_hoje: r.today, shown_at_8h: i < AGENDA_LIMIT })),
 };
}

/** Deterministic part of the 8h check-in: the user's own tasks and follow-ups due today or overdue, plus today's calendar. */
export async function morningAgenda(userId: string, timezone: string, now = new Date()): Promise<string> {
 const range = localDayRange(timezone, now);
 const rows = await withTenant(userId, async db => (await db.query<AgendaTask & { total: number; total_today: number }>(
  `SELECT titulo,owner,acao,is_mine,prazo,prazo>=$2 AS today,count(*) OVER ()::int AS total,(count(*) FILTER (WHERE prazo>=$2) OVER ())::int AS total_today
   FROM tarefas WHERE user_id=$1 AND status NOT IN ('concluida','cancelada') AND prazo IS NOT NULL AND prazo<$3 AND (is_mine OR acao='cobrar')
   ORDER BY ${AGENDA_ORDER}
   LIMIT ${AGENDA_LIMIT}`, [userId, range.from.toISOString(), range.to.toISOString(), timezone])).rows);
 const total = rows[0]?.total ?? 0, totalToday = rows[0]?.total_today ?? 0;
 const events = await calendarContext(userId, { from: range.from.toISOString(), to: range.to.toISOString() }, { timezone }).then(c => c.events).catch(() => []);
 return agendaText(rows.map(r => ({ ...r, prazo: new Date(r.prazo).toISOString() })), { today: totalToday, overdue: total - totalToday }, events, timezone);
}

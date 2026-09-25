import { fromZonedTime } from "date-fns-tz";
import { withTenant } from "../db";
import { CoachProviderUnavailableError, type CoachTelemetry } from "./provider";

/** Daily ceiling of AI spend per person, in US$. COACH_DAILY_BUDGET_USD overrides the default. */
export function dailyBudgetUsd() {
 const value = Number(process.env.COACH_DAILY_BUDGET_USD);
 return Number.isFinite(value) && value > 0 ? value : 3;
}
const usd = (value: number) => `US$ ${value.toFixed(2).replace(".", ",")}`;

/** Seconds until 00:05 of the next local day, when the ceiling starts over. */
export function secondsUntilNextDay(timezone: string, now = new Date()) {
 const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
 const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
 return Math.max(60, Math.ceil((fromZonedTime(`${tomorrow}T00:05:00`, timezone).getTime() - now.getTime()) / 1000));
}

/** No model call once the day's spend reached the ceiling. Scheduled work tries again the next day. */
export class CoachBudgetError extends CoachProviderUnavailableError {
 readonly retryAfterSeconds: number;
 constructor(cap: number, timezone: string, now = new Date()) {
  super(`O Coach chegou ao limite de gasto com IA de hoje (${usd(cap)}). Ele tenta de novo amanhã.`);
  this.retryAfterSeconds = secondsUntilNextDay(timezone, now);
 }
}

/** What the Coach's model calls cost since local midnight (every call is recorded with its cost). */
export async function spentToday(userId: string, timezone: string, now = new Date()): Promise<number> {
 const row = await withTenant(userId, db => db.query<{ spent: string }>(
  "SELECT coalesce(sum(cost_usd),0) AS spent FROM coach_model_runs WHERE user_id=$1 AND created_at>=(date_trunc('day',$2::timestamptz AT TIME ZONE $3) AT TIME ZONE $3)",
  [userId, now.toISOString(), timezone]));
 return Number(row.rows[0]?.spent ?? 0);
}

/** A failed ledger read never blocks the Coach: it is logged and counts as nothing spent. */
export async function budgetState(userId: string, timezone: string, now = new Date()) {
 const cap = dailyBudgetUsd();
 const spent = await spentToday(userId, timezone, now).catch(() => { console.error("coach budget read failed"); return 0; });
 return { cap, spent, exceeded: spent >= cap };
}

export const runCostUsd = (events: CoachTelemetry[]) => events.reduce((sum, event) => sum + (event.costUsd || 0), 0);

export const budgetReply = (cap: number) => `Hoje o Coach chegou ao limite de gasto com IA (${usd(cap)} por dia). Sua mensagem ficou salva, mas não vou analisá-la hoje: mande de novo amanhã.`;
export const budgetNotice = (cap: number) => `Com esta resposta, o Coach chegou ao limite de gasto com IA de hoje (${usd(cap)}). As próximas mensagens de hoje ficam salvas, sem análise.`;

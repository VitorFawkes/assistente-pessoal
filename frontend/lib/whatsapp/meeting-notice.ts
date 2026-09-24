import { acoesUrl } from "../public-url";
import { localHour, whatsappText } from "./format";

export type NoticeMeeting = {
 id: string; nome: string | null; original_filename: string | null; recorded_at: string | null; done_at: string;
 summary: string | null; executive_summary: string | null; needs_segmentation: boolean | null; duration_seconds: number | null;
};
export type NoticeTask = { titulo: string; owner: string | null; is_mine: boolean; prazo: string | null };

/** Daytime notices that go out on their own; the next ones wait for the 18h message. */
export const DAILY_NOTICES = 4;
/** How long a notice waits for the coach's question about the same meeting before going alone. */
export const COACH_WAIT_MS = 45 * 60_000;

/**
 * "now" sends the meeting notice; "hold" leaves it for later:
 * - 22h–7h nothing goes out;
 * - a meeting processed overnight goes with the 8h check-in, or alone from 9h if that did not happen;
 * - after DAILY_NOTICES in the day, the rest go with the 18h check-in, or alone from 19h.
 */
export function noticeSlot(doneAt: Date, now: Date, timezone: string, sentToday: number): "now" | "hold" {
 const hour = localHour(timezone, now);
 if (hour < 7 || hour >= 22) return "hold";
 const done = localHour(timezone, doneAt);
 if ((done >= 22 || done < 7) && now.getTime() - doneAt.getTime() < 12 * 3600_000) return hour >= 9 ? "now" : "hold";
 if (sentToday < DAILY_NOTICES) return "now";
 return hour >= 19 ? "now" : "hold";
}

const clip = (s: string, max: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };

/** Same content as the old "Reunião processada" notice, now sent by the coach number. */
export function meetingNoticeText(m: NoticeMeeting, tasks: NoticeTask[], merged: number, o: { timezone: string; now: Date; coach?: string | null }) {
 const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: o.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
 const ddmm = new Intl.DateTimeFormat("pt-BR", { timeZone: o.timezone, day: "2-digit", month: "2-digit" });
 const hhmm = new Intl.DateTimeFormat("pt-BR", { timeZone: o.timezone, hour: "2-digit", minute: "2-digit" });
 const at = m.recorded_at ? new Date(m.recorded_at) : null;
 const when = at ? (day(at) === day(o.now) ? hhmm.format(at) : `${ddmm.format(at)}, ${hhmm.format(at)}`) : null;
 const due = (p: string | null) => (p ? ` _(até ${ddmm.format(new Date(p))})_` : "");
 const summary = clip(m.summary || m.executive_summary || "", 420).replace(/_/g, " ");
 const lines = [`🎙️ *Reunião processada:* ${clip(m.nome || m.original_filename || "Reunião", 100)}${when ? ` (${when})` : ""}`];
 if (summary) lines.push("", `_${summary}_`);
 const list = (items: NoticeTask[], label: string, line: (t: NoticeTask) => string) => {
  if (!items.length) return;
  lines.push("", `${label} (${items.length})`, ...items.slice(0, 8).map(t => `• ${line(t)}`));
  if (items.length > 8) lines.push(`• e mais ${items.length - 8} no Ações`);
 };
 list(tasks.filter(t => t.is_mine), "✅ *Suas tarefas*", t => clip(t.titulo, 140) + due(t.prazo));
 list(tasks.filter(t => !t.is_mine), "👥 *Com outros*", t => `*${clip(t.owner || "Outra pessoa", 40)}:* ${clip(t.titulo, 140)}${due(t.prazo)}`);
 if (merged) lines.push("", merged === 1 ? "♻️ 1 já existia; anotei no card" : `♻️ ${merged} já existiam; anotei nos cards`);
 if (!tasks.length && !merged) lines.push("", "_Nenhuma tarefa nova nesta reunião._");
 lines.push("", `🔗 ${acoesUrl(`/reunioes/${m.id}`)}`);
 if (m.needs_segmentation) lines.push("", `🎙️ Áudio longo${m.duration_seconds ? ` (${(m.duration_seconds / 3600).toFixed(1).replace(".", ",")} h)` : ""}: revise os cortes em ${acoesUrl(`/reunioes/${m.id}/segmentar`)}`);
 const coach = o.coach?.replace(/^\s*Depois da reunião\s*/u, "").trim();
 if (coach) lines.push("", `💬 *Coach:* ${coach}`);
 return lines.join("\n");
}

/** Friday review on WhatsApp: the proposal only; evidence stays on the coach page. */
export function reviewText(c: { headline?: string; focus?: string; progress?: string; experiment?: string; question?: string }) {
 const parts = ["*Revisão da semana*"];
 if (c.headline?.trim()) parts.push(`*${clip(c.headline, 120)}*`);
 if (c.focus?.trim()) parts.push(whatsappText(c.focus.slice(0, 2500)));
 if (c.progress?.trim()) parts.push(`*Avanço:* ${whatsappText(c.progress.slice(0, 1500))}`);
 if (c.experiment?.trim()) parts.push(`*Experimento da semana:* ${whatsappText(c.experiment.slice(0, 1200))}`);
 if (c.question?.trim()) parts.push(clip(c.question, 500));
 parts.push(`Evidências e detalhes: ${acoesUrl("/coach")}`);
 return parts.join("\n\n");
}

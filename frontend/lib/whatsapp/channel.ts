import { query, withClient, withTenant } from "../db";
import { rateLimit } from "../rate-limit";
import { reviewPeriod } from "../coach/evidence";
import { enqueueJob, localJobDay, type ClaimedCoachJob } from "../coach/jobs";
import { coachModelAvailable } from "../coach/model";
import { coachStore } from "../coach/store";
import * as wa from "./evolution";
import { audioFile, codeInText, displayNumber, hashLinkCode, isAudio, LINK_CODE_TTL_MS, maskPhone, messageText, newLinkCode, quietHours, senderFromKey, splitForWhatsApp, whatsappText, type WaSender } from "./format";
import { COACH_WAIT_MS, meetingNoticeText, noticeSlot, reviewText, type NoticeMeeting, type NoticeTask } from "./meeting-notice";

type Link = { user_id: string; phone: string | null; lid: string | null; verified_at: Date | null; proactive: boolean; code_hash: string | null; code_expires_at: Date | null };
type OutKind = "reply" | "checkin" | "aviso" | "link" | "notice";
export type InboundTicket = { userId: string; jid: string };
export type WhatsappView = { available: boolean; coach_number: string | null; channel: { state: string; since: string | null; qr: string | null } | null; linked: boolean; phone: string | null; proactive: boolean; code_pending: boolean };

const secret = () => process.env.WHATSAPP_WEBHOOK_SECRET || "";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const linkColumns = "user_id,phone,lid,verified_at,proactive,code_hash,code_expires_at";
const destination = (l: Pick<Link, "phone" | "lid">) => (l.phone ? `${l.phone}@s.whatsapp.net` : l.lid ? `${l.lid}@lid` : null);
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);

/** First round: only the admin (Vitor) links a number; everyone else sees nothing. */
export const whatsappAllowed = (user: { is_admin: boolean }) => wa.whatsappConfigured() && user.is_admin;

async function linkByUser(userId: string) { return (await query<Link>(`SELECT ${linkColumns} FROM whatsapp_links WHERE user_id=$1`, [userId]))[0] ?? null; }
async function linkBySender(s: WaSender) {
 const rows = await query<Link>(`SELECT ${linkColumns} FROM whatsapp_links WHERE verified_at IS NOT NULL AND ((phone IS NOT NULL AND phone=$1) OR (lid IS NOT NULL AND lid=$2)) LIMIT 2`, [s.phone, s.lid]);
 return rows.length === 1 ? rows[0] : null;
}

export async function saveChannelState(state: wa.ChannelState) {
 await query("UPDATE whatsapp_channel SET state_since=CASE WHEN state<>$1 THEN now() ELSE state_since END,state=$1,checked_at=now(),qr=CASE WHEN $1='open' THEN NULL ELSE qr END WHERE id=1", [state]);
}
/** Webhooks can be missed; the 15-minute runner and the status probe ask the server directly. */
export async function refreshChannelState(): Promise<wa.ChannelState | null> {
 if (!wa.whatsappConfigured()) return null;
 const state = await wa.connectionState().catch(() => "close" as const);
 await saveChannelState(state);
 return state;
}
async function channelRow() {
 return (await query<{ state: string; state_since: Date; checked_at: Date; qr: string | null; qr_at: Date | null }>("SELECT state,state_since,checked_at,qr,qr_at FROM whatsapp_channel WHERE id=1"))[0] ?? null;
}
export async function channelStatus() {
 const row = await channelRow();
 return { state: row?.state ?? "close", since: iso(row?.state_since), checked_at: iso(row?.checked_at) };
}
export async function connectChannel() {
 const qr = await wa.connect();
 if (qr && qr.length <= 20000) await query("UPDATE whatsapp_channel SET qr=$1,qr_at=now(),state=CASE WHEN state='open' THEN state ELSE 'connecting' END WHERE id=1", [qr]);
 await refreshChannelState();
}

export async function whatsappView(user: { id: string; is_admin: boolean }): Promise<WhatsappView> {
 const coach_number = displayNumber(process.env.WHATSAPP_COACH_NUMBER);
 if (!whatsappAllowed(user)) return { available: false, coach_number, channel: null, linked: false, phone: null, proactive: true, code_pending: false };
 const [link, ch] = await Promise.all([linkByUser(user.id), channelRow()]);
 const qrFresh = !!(ch?.qr && ch.qr_at && Date.now() - new Date(ch.qr_at).getTime() < 60_000);
 return {
  available: true, coach_number,
  channel: ch ? { state: ch.state, since: iso(ch.state_since), qr: ch.state !== "open" && qrFresh ? ch.qr : null } : null,
  linked: !!link?.verified_at, phone: link?.verified_at ? maskPhone(link.phone) : null, proactive: link?.proactive ?? true,
  code_pending: !!(link?.code_hash && link.code_expires_at && new Date(link.code_expires_at).getTime() > Date.now()),
 };
}
/** The code proves the WhatsApp belongs to this account: the user sends it to the coach number. */
export async function startLink(userId: string) {
 if (secret().length < 32) throw new wa.WhatsappUnavailableError("whatsapp_not_configured");
 const code = newLinkCode();
 await query(`INSERT INTO whatsapp_links(user_id,code_hash,code_expires_at) VALUES($1,$2,now()+make_interval(secs=>$3))
  ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,code_expires_at=excluded.code_expires_at,updated_at=now()`, [userId, hashLinkCode(code, secret()), LINK_CODE_TTL_MS / 1000]);
 return code;
}
export async function unlink(userId: string) {
 await query("UPDATE whatsapp_links SET verified_at=NULL,phone=NULL,lid=NULL,code_hash=NULL,code_expires_at=NULL,updated_at=now() WHERE user_id=$1", [userId]);
}
export async function setProactive(userId: string, enabled: boolean) {
 await query("UPDATE whatsapp_links SET proactive=$2,updated_at=now() WHERE user_id=$1", [userId, enabled]);
}
async function tryLink(sender: WaSender, text: string): Promise<boolean> {
 const code = codeInText(text);
 if (!code || secret().length < 32 || !rateLimit(`wa-link:${sender.jid}`, 5, 3_600_000)) return false;
 const hash = hashLinkCode(code, secret());
 const userId = await withClient(async db => {
  await db.query("BEGIN");
  try {
   const target = (await db.query<{ user_id: string }>("SELECT user_id FROM whatsapp_links WHERE code_hash=$1 AND code_expires_at>now() FOR UPDATE", [hash])).rows[0];
   if (!target) { await db.query("ROLLBACK"); return null; }
   // A WhatsApp number belongs to one account: linking it here unlinks it elsewhere.
   await db.query("UPDATE whatsapp_links SET verified_at=NULL,phone=NULL,lid=NULL,updated_at=now() WHERE user_id<>$1 AND verified_at IS NOT NULL AND ((phone IS NOT NULL AND phone=$2) OR (lid IS NOT NULL AND lid=$3))", [target.user_id, sender.phone, sender.lid]);
   await db.query("UPDATE whatsapp_links SET phone=$2,lid=$3,verified_at=now(),code_hash=NULL,code_expires_at=NULL,last_inbound_at=now(),updated_at=now() WHERE user_id=$1", [target.user_id, sender.phone, sender.lid]);
   await db.query("COMMIT");
   return target.user_id;
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); throw e; }
 });
 if (!userId) return false;
 await send(userId, sender.jid, "Pronto! Este WhatsApp está ligado ao seu Coach. Pode me mandar mensagem ou áudio quando quiser.", "link");
 return true;
}

async function transcribe(base64: string, mimetype: unknown) {
 const apiKey = process.env.OPENAI_API_KEY;
 if (!apiKey) throw new Error("transcription_not_configured");
 const bytes = new Uint8Array(Buffer.from(base64, "base64"));
 if (!bytes.length || bytes.length > 24_000_000) throw new Error("audio_size");
 const file = audioFile(mimetype);
 const form = new FormData();
 form.append("file", new Blob([bytes], { type: file.type }), file.name);
 form.append("model", process.env.TRANSCRIBE_MODEL || "gpt-transcribe");
 const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(90_000) });
 if (!res.ok) throw new Error(`transcription_${res.status}`);
 return String(((await res.json()) as { text?: string }).text ?? "").trim();
}

type EvolutionData = {
 state?: unknown; qrcode?: { base64?: unknown }; messageType?: unknown;
 key?: { remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null; id?: unknown };
 message?: (Record<string, unknown> & { base64?: unknown; audioMessage?: { mimetype?: unknown } }) | null;
};
type EvolutionEvent = { event?: unknown; instance?: unknown; data?: EvolutionData };
/** Returns a ticket only for a new message from a linked user; everything else is handled here. */
export async function handleEvent(raw: unknown): Promise<InboundTicket | null> {
 const body = raw as EvolutionEvent;
 if (typeof body?.instance === "string" && body.instance !== (process.env.EVOLUTION_COACH_INSTANCE || "coach")) return null;
 const data = body?.data;
 if (body?.event === "connection.update") {
  const s = data?.state;
  await saveChannelState(s === "open" || s === "connecting" ? s : "close");
  return null;
 }
 if (body?.event === "qrcode.updated") {
  const qr = data?.qrcode?.base64;
  if (typeof qr === "string" && qr.startsWith("data:image/") && qr.length <= 20000) await query("UPDATE whatsapp_channel SET qr=$1,qr_at=now(),state=CASE WHEN state='open' THEN state ELSE 'connecting' END WHERE id=1", [qr]);
  return null;
 }
 if (body?.event !== "messages.upsert" || !data?.key || data.key.fromMe) return null;
 const sender = senderFromKey(data.key);
 if (!sender) return null;
 const text = messageText(data.message);
 // A valid pending code links (or moves) this number; unknown numbers otherwise get no answer and leave nothing stored.
 if (codeInText(text) && await tryLink(sender, text)) return null;
 const link = await linkBySender(sender);
 if (!link) return null;
 await query("UPDATE whatsapp_links SET phone=coalesce(phone,$2),lid=coalesce(lid,$3),last_inbound_at=now(),updated_at=now() WHERE user_id=$1", [link.user_id, sender.phone, sender.lid]).catch(() =>
  query("UPDATE whatsapp_links SET last_inbound_at=now(),updated_at=now() WHERE user_id=$1", [link.user_id]));
 let content = text, kind: "text" | "audio" = "text";
 if (isAudio(data.messageType, data.message)) {
  kind = "audio";
  const media = data.message?.base64;
  try { content = typeof media === "string" ? await transcribe(media, data.message?.audioMessage?.mimetype) : ""; } catch { content = ""; }
  if (!content) { await send(link.user_id, sender.jid, "Não consegui ouvir esse áudio. Pode mandar de novo ou escrever?", "notice"); return null; }
 } else if (!content) {
  await send(link.user_id, sender.jid, "Por enquanto eu entendo texto e áudio. Pode me escrever ou mandar um áudio?", "notice");
  return null;
 }
 const waId = typeof data.key.id === "string" ? data.key.id.slice(0, 128) : null;
 const inserted = await withTenant(link.user_id, async db => (await db.query(
  "INSERT INTO whatsapp_messages(user_id,direction,kind,wa_id,to_jid,body,status) VALUES($1,'in',$2,$3,$4,$5,'received') ON CONFLICT DO NOTHING RETURNING id",
  [link.user_id, kind, waId, sender.jid, content.slice(0, 6000)])).rowCount);
 return inserted ? { userId: link.user_id, jid: sender.jid } : null;
}

/** Messages typed in a row become one question; the answer shows "digitando…" while the coach works. */
export async function processInbound(ticket: InboundTicket) {
 await sleep(6_000);
 const batch = await withTenant(ticket.userId, async db => {
  const rows = (await db.query<{ id: string; body: string }>("SELECT id,body FROM whatsapp_messages WHERE user_id=$1 AND direction='in' AND status='received' ORDER BY created_at,id FOR UPDATE SKIP LOCKED", [ticket.userId])).rows;
  if (rows.length) await db.query("UPDATE whatsapp_messages SET status='batched',updated_at=now() WHERE id=ANY($1::uuid[])", [rows.map(r => r.id)]);
  return rows;
 });
 if (!batch.length) return;
 const message = batch.map(r => r.body.trim()).filter(Boolean).join("\n").slice(0, 6000);
 const profile = await coachStore(ticket.userId).profile();
 if (!profile.enabled) { await send(ticket.userId, ticket.jid, "Seu Coach está pausado. Ative de novo na página do Coach para conversarmos por aqui.", "notice"); return; }
 if (!coachModelAvailable()) { await send(ticket.userId, ticket.jid, "Não consigo responder agora. Sua mensagem ficou salva; tente de novo em alguns minutos.", "notice"); return; }
 let jobId: string;
 try { jobId = (await enqueueJob(ticket.userId, { kind: "chat", key: `whatsapp:${batch[0].id}`, payload: { message, channel: "whatsapp", reply_to: ticket.jid } })).id; }
 catch { await send(ticket.userId, ticket.jid, "Não consegui registrar sua mensagem agora. Tente de novo em alguns minutos.", "notice"); return; }
 const { drainJobs } = await import("../coach/jobs-worker");
 const until = Date.now() + 8 * 60_000;
 wa.typing(ticket.jid);
 const typing = setInterval(() => wa.typing(ticket.jid), 12_000);
 try {
  while (Date.now() < until) {
   await drainJobs(ticket.userId, { maxJobs: 2, deadline: Math.min(until, Date.now() + 480_000) }).catch(() => null);
   const status = await withTenant(ticket.userId, async db => (await db.query<{ status: string }>("SELECT status FROM coach_jobs WHERE user_id=$1 AND id=$2", [ticket.userId, jobId])).rows[0]?.status);
   if (status !== "queued" && status !== "running") return;
   await sleep(10_000);
  }
 } finally { clearInterval(typing); }
}

async function transmit(userId: string, id: string, to: string, text: string) {
 try {
  let waId: string | null = null;
  for (const chunk of splitForWhatsApp(text)) waId = await wa.sendText(to, chunk);
  await withTenant(userId, db => db.query("UPDATE whatsapp_messages SET status='sent',wa_id=$2,attempts=least(attempts+1,20),error=NULL,updated_at=now() WHERE id=$1", [id, waId]));
  return true;
 } catch (e) {
  await withTenant(userId, db => db.query("UPDATE whatsapp_messages SET status='failed',attempts=least(attempts+1,20),error=$2,updated_at=now() WHERE id=$1", [id, e instanceof Error ? e.message.slice(0, 300) : "send_failed"])).catch(() => {});
  return false;
 }
}
/** Recorded before sending, once per coach message (or dedup key), so a retry never sends the same thing twice. */
async function send(userId: string, to: string, text: string, kind: OutKind, ref: { coachMessageId?: string; jobId?: string; dedupKey?: string } = {}) {
 const id = await withTenant(userId, async db => {
  if (ref.coachMessageId) {
   const prior = (await db.query<{ id: string; status: string }>("SELECT id,status FROM whatsapp_messages WHERE user_id=$1 AND direction='out' AND coach_message_id=$2", [userId, ref.coachMessageId])).rows[0];
   if (prior) return prior.status === "sent" ? null : prior.id;
  }
  return (await db.query<{ id: string }>(`INSERT INTO whatsapp_messages(user_id,direction,kind,to_jid,coach_message_id,job_id,dedup_key,body,status) VALUES($1,'out',$2,$3,$4,$5,$6,$7,'queued')
   ON CONFLICT (user_id,dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING RETURNING id`,
   [userId, kind, to, ref.coachMessageId ?? null, ref.jobId ?? null, ref.dedupKey ?? null, text.slice(0, 20000)])).rows[0]?.id ?? null;
 });
 return id ? transmit(userId, id, to, text) : true;
}

/** Called after a job finishes: answers go back to WhatsApp; check-ins, meeting notices and the weekly review go out when allowed. */
export async function deliverJob(userId: string, job: Pick<ClaimedCoachJob, "id" | "kind" | "payload">) {
 if (!wa.whatsappConfigured()) return;
 const fromWhatsapp = job.kind === "chat" && job.payload.channel === "whatsapp";
 const scheduledReview = job.kind === "review" && job.payload.force !== true;
 if (!fromWhatsapp && job.kind !== "checkin" && !scheduledReview) return;
 const link = await linkByUser(userId);
 if (!link?.verified_at) return;
 const store = coachStore(userId);
 const now = new Date();
 let timezone = "America/Sao_Paulo";
 if (!fromWhatsapp) {
  if (!link.proactive) return;
  timezone = (await store.profile()).timezone;
  if (quietHours(timezone, now)) return;
 }
 // The linked number is the safest destination; the chat address only covers a link that knows no phone yet.
 const to = destination(link) || (fromWhatsapp && typeof job.payload.reply_to === "string" ? job.payload.reply_to : null);
 if (!to) return;
 if (scheduledReview) return deliverReview(userId, to, store, now);
 const message = await store.messageByKey(`${job.id}:assistant`);
 const checkin = job.kind === "checkin" ? String(job.payload.checkin) : null;
 if (message?.role === "assistant") {
  const meetingId = checkin === "meeting" && typeof job.payload.meeting_id === "string" ? job.payload.meeting_id : null;
  // The coach's question about a meeting rides on that meeting's notice while the notice has not gone out.
  if (!meetingId || !await sendMeetingNotice(userId, link, to, meetingId, timezone, now, { id: message.id, content: message.content, jobId: job.id }))
   await send(userId, to, whatsappText(message.content), fromWhatsapp ? "reply" : "checkin", { coachMessageId: message.id, jobId: job.id });
 }
 // Notices held overnight or beyond the daily limit go right after the 8h and 18h check-ins.
 if (checkin === "morning" || checkin === "evening") for (const m of await pendingMeetings(userId, link.verified_at, now)) await sendMeetingNotice(userId, link, to, m.id, timezone, now);
}

async function deliverReview(userId: string, to: string, store: ReturnType<typeof coachStore>, now: Date) {
 const profile = await store.profile();
 const period = reviewPeriod(now, profile.timezone, profile.review_day, profile.review_hour);
 // Only right after the weekly slot: later refreshes of an older review never message again.
 if (now.getTime() - Date.parse(period.to) > 48 * 3600_000) return;
 const review = (await store.reviews()).find(r => r.week_start === period.weekStart && !r.stale);
 if (review) await send(userId, to, reviewText(review.content), "checkin", { dedupKey: `review:${period.weekStart}` });
}

/** Processed meetings still without a notice: since the link, within 36 hours; parts of a split recording are shown on the page. */
async function pendingMeetings(userId: string, since: Date, now: Date, meetingId?: string): Promise<NoticeMeeting[]> {
 const rows = await withTenant(userId, async db => (await db.query<Omit<NoticeMeeting, "recorded_at" | "done_at"> & { recorded_at: Date | null; done_at: Date }>(
  `SELECT m.id,m.nome,m.original_filename,m.recorded_at,m.done_at,m.summary,m.raw_ai_response->>'executive_summary' AS executive_summary,m.needs_segmentation,m.duration_seconds
   FROM meetings m WHERE m.user_id=$1 AND m.status='done' AND m.source IS DISTINCT FROM 'segmented'
    AND m.done_at>greatest($3::timestamptz-interval '36 hours',$2::timestamptz) AND ($4::uuid IS NULL OR m.id=$4)
    AND NOT EXISTS (SELECT 1 FROM whatsapp_messages w WHERE w.user_id=m.user_id AND w.dedup_key='meeting:'||m.id::text)
   ORDER BY m.done_at,m.id LIMIT 10`, [userId, since.toISOString(), now.toISOString(), meetingId ?? null])).rows);
 return rows.map(r => ({ ...r, recorded_at: iso(r.recorded_at), done_at: iso(r.done_at)! }));
}
/** Recorded once per meeting before sending; false when another delivery already took this meeting. */
async function sendMeetingNotice(userId: string, link: Link, to: string, meetingId: string, timezone: string, now: Date, coach?: { id: string; content: string; jobId: string }) {
 const meeting = link.verified_at ? (await pendingMeetings(userId, link.verified_at, now, meetingId))[0] : null;
 if (!meeting) return false;
 const text = await withTenant(userId, async db => {
  const tasks = (await db.query<Omit<NoticeTask, "prazo"> & { prazo: Date | null }>("SELECT titulo,owner,is_mine,prazo FROM tarefas WHERE user_id=$1 AND meeting_id=$2 AND status<>'cancelada' ORDER BY is_mine DESC,prazo NULLS LAST,created_at,id", [userId, meeting.id])).rows;
  const merged = (await db.query<{ n: number }>("SELECT count(DISTINCT tarefa_id)::int AS n FROM tarefa_mencoes WHERE user_id=$1 AND meeting_id=$2 AND origem='reuniao'", [userId, meeting.id])).rows[0]?.n ?? 0;
  return meetingNoticeText(meeting, tasks.map(t => ({ ...t, prazo: iso(t.prazo) })), merged, { timezone, now, coach: coach ? whatsappText(coach.content) : null });
 });
 const id = await withTenant(userId, async db => (await db.query<{ id: string }>(`INSERT INTO whatsapp_messages(user_id,direction,kind,to_jid,coach_message_id,job_id,dedup_key,body,status) VALUES($1,'out','notice',$2,$3,$4,$5,$6,'queued')
  ON CONFLICT (user_id,dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING RETURNING id`, [userId, to, coach?.id ?? null, coach?.jobId ?? null, `meeting:${meeting.id}`, text.slice(0, 20000)])).rows[0]?.id ?? null);
 if (!id) return false;
 await transmit(userId, id, to, text);
 return true;
}
/** The coach question about a meeting, when one was prepared: wait while it runs; merge it while it has not gone out. */
async function coachQuestion(userId: string, meetingId: string) {
 const row = await withTenant(userId, async db => (await db.query<{ job_id: string; status: string; message_id: string | null; content: string | null; sent: boolean }>(
  `SELECT j.id AS job_id,j.status,m.id AS message_id,m.content,EXISTS(SELECT 1 FROM whatsapp_messages w WHERE w.user_id=j.user_id AND w.coach_message_id=m.id) AS sent
   FROM coach_jobs j LEFT JOIN coach_messages m ON m.user_id=j.user_id AND m.idempotency_key=j.id::text||':assistant'
   WHERE j.user_id=$1 AND j.idempotency_key=$2`, [userId, `scheduled:meeting:${meetingId}`])).rows[0]);
 if (!row) return null;
 if (row.status === "queued" || row.status === "running") return "wait" as const;
 return row.message_id && row.content && !row.sent ? { id: row.message_id, content: row.content, jobId: row.job_id } : null;
}
/** 15-minute runner: each processed meeting gets one notice, when noticeSlot allows it. */
export async function meetingNotices(userId: string, now = new Date()) {
 if (!wa.whatsappConfigured()) return 0;
 const link = await linkByUser(userId);
 const to = link?.verified_at && link.proactive ? destination(link) : null;
 if (!link?.verified_at || !to) return 0;
 const pending = await pendingMeetings(userId, link.verified_at, now);
 if (!pending.length) return 0;
 const timezone = await withTenant(userId, async db => (await db.query<{ timezone: string }>("SELECT timezone FROM coach_profiles WHERE user_id=$1", [userId])).rows[0]?.timezone || "America/Sao_Paulo");
 let today = await withTenant(userId, async db => (await db.query<{ n: number }>(
  "SELECT count(*)::int AS n FROM whatsapp_messages WHERE user_id=$1 AND direction='out' AND dedup_key LIKE 'meeting:%' AND to_char(created_at AT TIME ZONE $2,'YYYY-MM-DD')=$3",
  [userId, timezone, localJobDay(timezone, now)])).rows[0]?.n ?? 0);
 let sent = 0;
 for (const m of pending) {
  if (noticeSlot(new Date(m.done_at), now, timezone, today) !== "now") continue;
  const coach = await coachQuestion(userId, m.id);
  if (coach === "wait" && now.getTime() - Date.parse(m.done_at) < COACH_WAIT_MS) continue;
  if (await sendMeetingNotice(userId, link, to, m.id, timezone, now, coach && coach !== "wait" ? coach : undefined)) { sent++; today++; }
 }
 return sent;
}
export async function notifyChatFailure(userId: string, job: Pick<ClaimedCoachJob, "kind" | "payload">) {
 if (!wa.whatsappConfigured() || job.kind !== "chat" || job.payload.channel !== "whatsapp") return;
 const link = await linkByUser(userId);
 const to = (link?.verified_at ? destination(link) : null) || (typeof job.payload.reply_to === "string" ? job.payload.reply_to : null);
 if (to) await send(userId, to, "Não consegui responder agora. Sua mensagem ficou salva; tente de novo em alguns minutos.", "notice");
}
/** The 15-minute runner retries failed sends for 6 hours; messages the coach starts still respect quiet hours. */
export async function retryDeliveries(userId: string) {
 if (!wa.whatsappConfigured()) return 0;
 const rows = await withTenant(userId, async db => (await db.query<{ id: string; kind: string; to_jid: string | null; body: string; dedup_key: string | null }>(
  "SELECT id,kind,to_jid,body,dedup_key FROM whatsapp_messages WHERE user_id=$1 AND direction='out' AND status IN ('queued','failed') AND attempts<5 AND created_at>now()-interval '6 hours' AND updated_at<now()-interval '2 minutes' ORDER BY created_at LIMIT 5", [userId])).rows);
 if (!rows.length) return 0;
 const quiet = quietHours((await coachStore(userId).profile()).timezone, new Date());
 let sent = 0;
 for (const row of rows) if (row.to_jid && !(quiet && (row.kind === "checkin" || row.dedup_key?.startsWith("meeting:"))) && await transmit(userId, row.id, row.to_jid, row.body)) sent++;
 return sent;
}

/** Operational notice to one user's linked WhatsApp; silently skipped when there is none. */
export async function sendToUser(userId: string, text: string) {
 if (!wa.whatsappConfigured()) return false;
 const link = await linkByUser(userId);
 const to = link?.verified_at ? destination(link) : null;
 return to ? send(userId, to, text.slice(0, 3000), "notice") : false;
}
/** System alerts from other Welcome systems, always to the configured owner. */
export async function sendAviso(text: string) {
 const userId = process.env.WHATSAPP_AVISO_USER_ID || "";
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new wa.WhatsappUnavailableError("aviso_not_configured");
 const link = await linkByUser(userId);
 const to = link?.verified_at ? destination(link) : null;
 if (!to) throw new wa.WhatsappUnavailableError("aviso_not_linked");
 return send(userId, to, text.slice(0, 3000), "aviso");
}

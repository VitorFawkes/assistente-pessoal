import { createHash, randomInt } from "node:crypto";
import { splitChatPresentation } from "../coach/chat-presentation";

export type WaSender = { phone: string | null; lid: string | null; jid: string };
type WaKey = { remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null; id?: unknown };

/** A 1:1 chat can arrive by phone JID or by an opaque LID (or both); groups and broadcasts are never a sender. */
export function senderFromKey(key: WaKey | null | undefined): WaSender | null {
 const ids = [key?.remoteJid, key?.remoteJidAlt].filter((v): v is string => typeof v === "string" && v.includes("@"));
 if (!ids.length || ids.some(j => /@(g\.us|broadcast|newsletter)$/.test(j))) return null;
 let phone: string | null = null, lid: string | null = null;
 for (const jid of ids) {
  const [user, server] = jid.split("@");
  const digits = (user || "").split(":")[0].replace(/\D/g, "");
  if (!digits) continue;
  if (server === "s.whatsapp.net" && !phone && /^[0-9]{8,15}$/.test(digits)) phone = digits;
  else if (server === "lid" && !lid && /^[0-9]{5,25}$/.test(digits)) lid = digits;
 }
 if (!phone && !lid) return null;
 return { phone, lid, jid: phone ? `${phone}@s.whatsapp.net` : `${lid}@lid` };
}

type WaMessage = Record<string, unknown> & {
 conversation?: unknown; extendedTextMessage?: { text?: unknown }; imageMessage?: { caption?: unknown };
 videoMessage?: { caption?: unknown }; documentMessage?: { caption?: unknown }; audioMessage?: { mimetype?: unknown };
 buttonsResponseMessage?: { selectedDisplayText?: unknown }; listResponseMessage?: { title?: unknown };
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
export function messageText(message: WaMessage | null | undefined): string {
 if (!message) return "";
 return (str(message.conversation) || str(message.extendedTextMessage?.text) || str(message.imageMessage?.caption) || str(message.videoMessage?.caption)
  || str(message.documentMessage?.caption) || str(message.buttonsResponseMessage?.selectedDisplayText) || str(message.listResponseMessage?.title)).trim();
}
export const isAudio = (messageType: unknown, message: WaMessage | null | undefined) => messageType === "audioMessage" || !!message?.audioMessage;
export function audioFile(mimetype: unknown): { type: string; name: string } {
 const type = (str(mimetype).split(";")[0] || "audio/ogg").trim().toLowerCase();
 const ext = type.includes("ogg") || type.includes("opus") ? "ogg" : type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a" : type.includes("mpeg") || type.includes("mp3") ? "mp3" : type.includes("wav") ? "wav" : type.includes("webm") ? "webm" : "ogg";
 return { type, name: `audio.${ext}` };
}

export const LINK_CODE_TTL_MS = 15 * 60_000;
export const newLinkCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const hashLinkCode = (code: string, secret: string) => createHash("sha256").update(`whatsapp-link:${secret}:${code}`).digest("hex");
/** A link code is exactly one standalone group of 6 digits in a short message. */
export function codeInText(text: string): string | null {
 if (text.length > 80) return null;
 const found = text.match(/(?<!\d)\d{6}(?!\d)/g);
 return found && found.length === 1 ? found[0] : null;
}

export function localHour(timezone: string, now: Date) {
 return Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now));
}
/** Messages the coach starts on its own never leave between 22h and 7h (answers to the user always do). */
export const quietHours = (timezone: string, now: Date) => { const h = localHour(timezone, now); return h >= 22 || h < 7; };

export const WA_CHUNK = 3800;
/** Coach answers are Markdown for the page; WhatsApp gets the answer only, in WhatsApp markup. */
export function whatsappText(content: string): string {
 const { answer, reading } = splitChatPresentation(content);
 let text = answer.replace(/\r/g, "")
  .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
  .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
  .replace(/__([^_\n]+)__/g, "_$1_")
  .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)")
  .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
  .replace(/\n{3,}/g, "\n\n").trim();
 if (reading) text += "\n\n_As leituras e evidências desta resposta ficam na página do Coach._";
 return text;
}
export function splitForWhatsApp(text: string, max = WA_CHUNK): string[] {
 const chunks: string[] = [];
 let current = "";
 const push = () => { if (current.trim()) chunks.push(current.trim()); current = ""; };
 for (const paragraph of text.split(/\n\n/)) {
  if (paragraph.length > max) {
   push();
   for (let i = 0; i < paragraph.length; i += max) chunks.push(paragraph.slice(i, i + max));
   continue;
  }
  if (current && current.length + 2 + paragraph.length > max) push();
  current = current ? `${current}\n\n${paragraph}` : paragraph;
 }
 push();
 return chunks;
}
export const maskPhone = (phone: string | null) => (phone ? `final ${phone.slice(-4)}` : null);
export function displayNumber(raw: string | undefined) {
 const d = (raw || "").replace(/\D/g, "");
 const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
 return m ? `(${m[1]}) ${m[2]}-${m[3]}` : d || null;
}

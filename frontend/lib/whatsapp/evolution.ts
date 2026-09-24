/** Private HTTP client for the coach-whatsapp server (reachable only inside the server network). */
export class WhatsappUnavailableError extends Error {}

const config = () => ({ url: (process.env.EVOLUTION_COACH_URL || "").replace(/\/+$/, ""), key: process.env.EVOLUTION_COACH_KEY || "", instance: process.env.EVOLUTION_COACH_INSTANCE || "coach" });
export const whatsappConfigured = () => { const c = config(); return !!c.url && c.key.length >= 16; };

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
 const c = config();
 if (!c.url || !c.key) throw new WhatsappUnavailableError("whatsapp_not_configured");
 let res: Response;
 try {
  res = await fetch(`${c.url}${path.replace("{instance}", encodeURIComponent(c.instance))}`, {
   method, headers: { apikey: c.key, "Content-Type": "application/json" },
   body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
 } catch { throw new WhatsappUnavailableError("whatsapp_unreachable"); }
 // Never surface the response body: it can echo message content or credentials.
 if (!res.ok) throw new WhatsappUnavailableError(`whatsapp_http_${res.status}`);
 return (await res.json().catch(() => ({}))) as T;
}

export type ChannelState = "open" | "connecting" | "close";
export async function connectionState(): Promise<ChannelState> {
 const r = await call<{ instance?: { state?: string } }>("GET", "/instance/connectionState/{instance}", undefined, 10_000);
 const s = r.instance?.state;
 return s === "open" || s === "connecting" ? s : "close";
}
/** Starts pairing; returns the QR image (data URL) while the number is not connected. */
export async function connect(): Promise<string | null> {
 const r = await call<{ base64?: string }>("GET", "/instance/connect/{instance}", undefined, 30_000);
 return typeof r.base64 === "string" && r.base64.startsWith("data:image/") ? r.base64 : null;
}
export async function sendText(to: string, text: string): Promise<string | null> {
 const r = await call<{ key?: { id?: string } }>("POST", "/message/sendText/{instance}", { number: to, text, linkPreview: false }, 30_000);
 return typeof r.key?.id === "string" ? r.key.id.slice(0, 128) : null;
}
/** Shows "digitando…" for delayMs; fire-and-forget, failures are irrelevant. */
export function typing(to: string, delayMs = 15_000) {
 void call("POST", "/chat/sendPresence/{instance}", { number: to, presence: "composing", delay: delayMs }, delayMs + 10_000).catch(() => {});
}

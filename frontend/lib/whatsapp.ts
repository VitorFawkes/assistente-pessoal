import "server-only";

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE;
const DESTINO = process.env.WHATSAPP_DESTINO;

export async function sendWhatsApp(text: string): Promise<void> {
  if (!EVOLUTION_URL || !EVOLUTION_KEY || !EVOLUTION_INSTANCE || !DESTINO) {
    console.warn("[whatsapp] env vars ausentes — mensagem não enviada");
    return;
  }
  try {
    const res = await fetch(
      `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_KEY,
        },
        body: JSON.stringify({ number: DESTINO, text }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[whatsapp] HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn("[whatsapp] erro ao enviar:", err);
  }
}

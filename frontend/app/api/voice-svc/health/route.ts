// Proxy pro voice-svc/health (DNS interno do easypanel — não exposto externamente).
// Útil pra diagnóstico: confirma que voice-svc está rodando, retorna config + thresholds.
import { NextResponse } from "next/server";

const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";

export async function GET() {
  try {
    const res = await fetch(`${VOICE_SVC_URL}/health`, {
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // mantém como string
    }
    return NextResponse.json(
      { upstream_status: res.status, voice_svc_url: VOICE_SVC_URL, body: parsed },
      { status: res.ok ? 200 : 502 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: "falha ao chamar voice-svc",
        message: e instanceof Error ? e.message : String(e),
        voice_svc_url: VOICE_SVC_URL,
      },
      { status: 502 },
    );
  }
}

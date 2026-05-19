import { type NextRequest, NextResponse } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Microservice voice-svc (Python + SpeechBrain ECAPA + pgvector).
// Default aponta pro DNS interno do easypanel — sem domínio público.
const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  try {
    const res = await fetch(`${VOICE_SVC_URL}/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: id }),
      // Identify pode demorar (extração ffmpeg + N embeddings + pgvector)
      signal: AbortSignal.timeout(120_000),
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "voice-svc retornou erro", status: res.status, body: text },
        { status: 502 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "voice-svc respondeu não-JSON", body: text },
        { status: 502 },
      );
    }
    return NextResponse.json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "falha ao chamar voice-svc", message: msg, voice_svc_url: VOICE_SVC_URL },
      { status: 502 },
    );
  }
}

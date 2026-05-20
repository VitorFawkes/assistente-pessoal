// Proxy pro voice-svc/clip — recorta trecho via ffmpeg, retorna MP3 64kbps.
// Frontend serve o stream direto pro <audio>.
import { type NextRequest, NextResponse } from "next/server";

const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const meetingId = url.searchParams.get("meeting_id") || "";
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";

  if (!UUID_RE.test(meetingId)) {
    return NextResponse.json({ error: "meeting_id inválido" }, { status: 400 });
  }
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) {
    return NextResponse.json({ error: "start/end inválidos" }, { status: 400 });
  }

  const upstream = `${VOICE_SVC_URL}/clip?meeting_id=${meetingId}&start=${s}&end=${e}`;
  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: "voice-svc clip falhou", status: res.status, body: body.slice(0, 300) },
        { status: 502 },
      );
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "falha ao chamar voice-svc", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

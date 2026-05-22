import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  try {
    const res = await fetch(`${VOICE_SVC_URL}/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: id, user_id: user.id }),
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
});

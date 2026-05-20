// DELETE /api/samples/[id] — soft delete de uma amostra de voz (proxy voice-svc).
import { type NextRequest, NextResponse } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  try {
    const res = await fetch(`${VOICE_SVC_URL}/samples/${id}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep */
    }
    return NextResponse.json(parsed, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: "falha ao chamar voice-svc", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

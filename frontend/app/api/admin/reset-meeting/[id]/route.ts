import { type NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

type Segment = { speaker: string; start: number; end: number; text: string };

type Body = {
  segments?: Segment[];
  text?: string;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const authHeader = req.headers.get("x-admin-token") || "";
  if (!WEBHOOK_TOKEN || authHeader !== WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const segments = Array.isArray(body.segments) ? body.segments : [];
  const text = typeof body.text === "string" ? body.text : "";

  try {
    const result = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const r = await c.query<{ id: string }>(
          `UPDATE meetings SET
             status = 'analyzing',
             segments = $1::jsonb,
             transcription = $2,
             summary = NULL,
             raw_ai_response = NULL,
             speaker_labels = '{}'::jsonb,
             speaker_pessoas = '{}'::jsonb,
             speaker_labels_proposed = NULL,
             status_error = NULL,
             done_at = NULL
           WHERE id = $3::uuid
           RETURNING id`,
          [JSON.stringify(segments), text, id],
        );
        if (!r.rows.length) throw new Error("NOT_FOUND");
        await c.query(`DELETE FROM tarefas WHERE meeting_id = $1::uuid`, [id]);
        await c.query("COMMIT");
        return { id: r.rows[0].id };
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    });
    return NextResponse.json({
      ok: true,
      meeting_id: result.id,
      segments_count: segments.length,
      text_length: text.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

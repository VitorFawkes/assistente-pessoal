import { type NextRequest, NextResponse } from "next/server";
import { query, withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

type Segment = { speaker: string; start: number; end: number; text: string };

type Body = {
  segments?: Segment[];
  text?: string;
  user_id?: string;
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

  // Resolve user_id: do body se vier, senão admin user (única conta no setup atual).
  // `users` não tem RLS, então essa query passa direto.
  let userId = typeof body.user_id === "string" && UUID_RE.test(body.user_id)
    ? body.user_id
    : "";
  if (!userId) {
    const r = await query<{ id: string }>(
      `SELECT id FROM users WHERE is_admin = TRUE AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    );
    if (!r.length) {
      return NextResponse.json({ error: "no admin user found" }, { status: 500 });
    }
    userId = r[0].id;
  }

  try {
    const result = await withTenant(userId, async (c) => {
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
      return { id: r.rows[0].id };
    });
    return NextResponse.json({
      ok: true,
      meeting_id: result.id,
      segments_count: segments.length,
      text_length: text.length,
      user_id_used: userId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

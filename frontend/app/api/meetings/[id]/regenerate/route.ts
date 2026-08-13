import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { regenerateMeeting } from "@/lib/regenerate";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const transcription = await withTenant(user.id, async (db) => {
    const r = await db.query<{ transcription: string | null }>(
      `SELECT transcription FROM meetings WHERE id = $1::uuid`,
      [id],
    );
    return r.rows[0];
  });
  if (!transcription) {
    return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  }
  if (!transcription.transcription?.trim()) {
    return NextResponse.json({ error: "sem transcrição" }, { status: 422 });
  }

  const result = await regenerateMeeting(user.id, id);
  return NextResponse.json(result);
});

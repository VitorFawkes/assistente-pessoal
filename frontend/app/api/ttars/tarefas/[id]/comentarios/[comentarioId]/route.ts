import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { apagarComentarioDaTarefa } from "@/lib/ttars-tela";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; comentarioId: string }> };

// Apagar um comentário: só quem escreveu.
export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id, comentarioId } = await ctx.params;
  const r = await apagarComentarioDaTarefa(user.id, id, comentarioId);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: r.status });
});

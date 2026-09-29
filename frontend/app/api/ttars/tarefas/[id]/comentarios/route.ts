import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { comentarNaTarefa } from "@/lib/ttars-tela";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Comentário numa ação. Quem vê a ação (dono, quem faz, projeto, time, marcado) comenta. Corpo: { texto }.
// Não avisa ninguém.
export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { texto?: unknown } | null;
  const r = await comentarNaTarefa(user.id, id, b?.texto);
  return r.ok ? NextResponse.json({ comentario: r.valor }) : NextResponse.json({ error: r.erro }, { status: r.status });
});

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { puxarAcao } from "@/lib/puxar";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Quem estava na reunião puxa a ação para a própria lista.
export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const r = await puxarAcao(user, id);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: r.status });
});

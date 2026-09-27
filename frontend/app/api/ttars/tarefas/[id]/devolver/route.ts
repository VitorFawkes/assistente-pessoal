import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { devolverAcao } from "@/lib/puxar";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Desfaz o "puxar": a ação volta para quem fazia antes.
export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const r = await devolverAcao(user, id);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: r.status });
});

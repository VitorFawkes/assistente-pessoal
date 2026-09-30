import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { ligarFormulario } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Tira o formulário do ar (os pedidos feitos continuam).
export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const r = await ligarFormulario(user, id, false);
  return NextResponse.json(r.json, { status: r.status });
});

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { publicarFormulario } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// O rascunho vira a versão no ar (versão + 1).
export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const r = await publicarFormulario(user, id);
  return NextResponse.json(r.json, { status: r.status });
});

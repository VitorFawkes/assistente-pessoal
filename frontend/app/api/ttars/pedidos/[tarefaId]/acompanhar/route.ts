import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { acompanharPedido } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ tarefaId: string }> };

// "Acompanhar este pedido": quem pode pedir o formulário entra no Quem vê do pedido (como quem pediu).
export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { tarefaId } = await ctx.params;
  const r = await acompanharPedido(user, tarefaId);
  return NextResponse.json(r.json, { status: r.status });
});

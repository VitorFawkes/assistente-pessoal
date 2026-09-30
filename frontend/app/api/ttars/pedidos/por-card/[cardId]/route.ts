import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { pedidosDoCard } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cardId: string }> };

// Os pedidos vivos de um casamento do TTARS (botão da página do casamento).
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { cardId } = await ctx.params;
  const r = await pedidosDoCard(user, cardId);
  return NextResponse.json(r.json, { status: r.status });
});

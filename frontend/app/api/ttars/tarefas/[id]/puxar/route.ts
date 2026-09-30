import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { puxarAcao } from "@/lib/puxar";
import { travaDoPedido } from "@/lib/pedidos-trava";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Quem estava na reunião puxa a ação para a própria lista.
export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const trava = await travaDoPedido(user.id, [id], { campos: ["quem_faz"] });
  if (trava) return NextResponse.json({ error: trava.erro }, { status: trava.status });
  const r = await puxarAcao(user, id);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: r.status });
});

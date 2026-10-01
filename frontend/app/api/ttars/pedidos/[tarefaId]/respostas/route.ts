import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { completarRespostas } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ tarefaId: string }> };

// Completar as respostas depois (quem pediu, o marketing ou o administrador; até o pedido ser encerrado).
// Corpo: { respostas: {id: {valor, nao_temos?}} } (as que não vierem ficam). 200 { ok, mudaram, aviso? } | 400 | 403 | 404 | 409.
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { tarefaId } = await ctx.params;
  const r = await completarRespostas(user, tarefaId, await req.json().catch(() => null));
  return NextResponse.json(r.json, { status: r.status });
});

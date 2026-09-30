import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { apagarFormulario, salvarRascunho } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Salva o rascunho (o que está no ar só muda ao publicar). Corpo: { nome, explica, icone, perguntas, publico, destino }.
export const PUT = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const r = await salvarRascunho(user, id, await req.json().catch(() => null));
  return NextResponse.json(r.json, { status: r.status });
});

// Apaga o formulário (só sem nenhum pedido; com pedido, desligar).
export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const r = await apagarFormulario(user, id);
  return NextResponse.json(r.json, { status: r.status });
});

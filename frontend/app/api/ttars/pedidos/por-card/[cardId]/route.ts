import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { pedidosDoCard } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cardId: string }> };

// Todos os pedidos vivos (não cancelados nem apagados) de um casamento do TTARS, de todos os formulários cujo público
// inclui quem chama, do mais novo ao mais antigo: { pedidos: { formulario_id, formulario_nome, tarefa_id, pedido_por,
// criado_em, situacao, eu_vejo }[] } (página do casamento).
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { cardId } = await ctx.params;
  const r = await pedidosDoCard(user, cardId);
  return NextResponse.json(r.json, { status: r.status });
});

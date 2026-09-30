import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { criarPedido } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

// Pedido ao Marketing pelo TTARS: vira uma ação de quem pede (quem faz = a pessoa do marketing do formulário)
// e uma página no Notion do marketing. Corpo: { formulario_id, versao, card: {id, titulo} | null,
// respostas: {id: {valor, nao_temos?}}, pessoas: e-mails, time_id? }. 201 { tarefa_id } | 409 repetido/versão.
export const POST = withAuth(async (user, req) => {
  const corpo = await req.json().catch(() => null);
  const r = await criarPedido(user, corpo);
  return NextResponse.json(r.json, { status: r.status });
});

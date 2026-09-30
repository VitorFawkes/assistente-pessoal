import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { formulariosParaMontar, novoFormulario } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

// Montar formulários de pedido (só quem monta ou o administrador): a lista inteira, com os rascunhos.
export const GET = withAuth(async (user) => {
  const r = await formulariosParaMontar(user);
  return NextResponse.json(r.json, { status: r.status });
});

// Formulário novo (nasce rascunho). Corpo: { nome?, explica?, icone?, perguntas?, publico?, destino? }.
export const POST = withAuth(async (user, req) => {
  const r = await novoFormulario(user, await req.json().catch(() => null));
  return NextResponse.json(r.json, { status: r.status });
});

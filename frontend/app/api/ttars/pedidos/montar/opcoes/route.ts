import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { opcoesParaMontar } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

// Para onde um formulário pode mandar e quem pode pedir: pessoas do marketing, projetos do Notion, empresas e times.
export const GET = withAuth(async (user) => {
  const r = await opcoesParaMontar(user);
  return NextResponse.json(r.json, { status: r.status });
});

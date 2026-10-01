import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { formulariosParaPedir } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

// Os formulários de pedido que quem chama pode usar agora (no ar e com ela no público), se ela monta formulários
// e as marcas dela (minhas_marcas: área dos formulários "da marca de quem pede").
export const GET = withAuth(async (user) => {
  const r = await formulariosParaPedir(user);
  return NextResponse.json(r.json, { status: r.status });
});

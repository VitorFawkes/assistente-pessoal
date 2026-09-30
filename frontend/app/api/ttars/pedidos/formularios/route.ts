import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { formulariosParaPedir } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

// Os formulários de pedido que quem chama pode usar agora (no ar e com ela no público) e se ela monta formulários.
export const GET = withAuth(async (user) => {
  const r = await formulariosParaPedir(user);
  return NextResponse.json(r.json, { status: r.status });
});

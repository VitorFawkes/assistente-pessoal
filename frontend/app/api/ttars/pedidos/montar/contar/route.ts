import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { contarPublico } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

// Quantas pessoas veem o formulário com este público e quantas já entram no Ações. Corpo: { publico }.
export const POST = withAuth(async (user, req) => {
  const r = await contarPublico(user, await req.json().catch(() => null));
  return NextResponse.json(r.json, { status: r.status });
});

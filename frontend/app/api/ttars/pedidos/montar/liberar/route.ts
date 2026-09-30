import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { liberarPessoas } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

// "Liberar essas pessoas" (só o administrador): libera o Ações para quem ainda não entra. Corpo: { emails }.
export const POST = withAuth(async (user, req) => {
  const r = await liberarPessoas(user, await req.json().catch(() => null));
  return NextResponse.json(r.json, { status: r.status });
});

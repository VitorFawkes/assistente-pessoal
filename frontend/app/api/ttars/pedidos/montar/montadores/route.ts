import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { montadores, porMontador, tirarMontador } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

// Quem monta os formulários de pedido. Lê quem entra no Ações; muda quem já monta ou o administrador.
// Todas devolvem { montadores: {email, nome}[], pode_mudar }.
export const GET = withAuth(async (user) => {
  const r = await montadores(user);
  return NextResponse.json(r.json, { status: r.status });
});

// Põe alguém da lista do TTARS. Corpo: { email }.
export const POST = withAuth(async (user, req) => {
  const r = await porMontador(user, await req.json().catch(() => null));
  return NextResponse.json(r.json, { status: r.status });
});

// Tira alguém (nunca o último). Corpo: { email } (ou ?email=).
export const DELETE = withAuth(async (user, req) => {
  const corpo = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = corpo?.email ?? new URL(req.url).searchParams.get("email");
  const r = await tirarMontador(user, { email });
  return NextResponse.json(r.json, { status: r.status });
});

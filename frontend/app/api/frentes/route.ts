import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { frentesFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (user) => {
  const frentes = await frentesFor(user.id).list();
  return NextResponse.json({ frentes });
});

export const POST = withAuth(async (user, req) => {
  let body: { nome?: string };
  try {
    body = (await (req as NextRequest).json()) as { nome?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nome = (body.nome ?? "").trim();
  if (!nome) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  const frente = await frentesFor(user.id).create(nome);
  return NextResponse.json({ frente });
});

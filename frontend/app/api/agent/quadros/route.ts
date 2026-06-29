import { type NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";

export const dynamic = "force-dynamic";

// GET /api/agent/quadros — lista os quadros do user (com contagens).
export const GET = withAgentAuth(async ({ user }) => {
  const quadros = await quadrosFor(user.id).list();
  return NextResponse.json(quadros);
});

// POST /api/agent/quadros — cria um quadro. Body: { nome*, descricao? }
export const POST = withAgentAuth(async ({ user }, req) => {
  let body: { nome?: string; descricao?: string };
  try {
    body = (await (req as NextRequest).json()) as { nome?: string; descricao?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nome = (body.nome ?? "").trim();
  if (!nome) {
    return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  }
  try {
    const quadro = await quadrosFor(user.id).criar(nome, body.descricao?.trim() || undefined);
    return NextResponse.json(quadro, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

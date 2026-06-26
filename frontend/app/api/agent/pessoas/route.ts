import { type NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { pessoasFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

// GET /api/agent/pessoas — lista pessoas do user (com contagens).
export const GET = withAgentAuth(async ({ user }) => {
  const rows = await pessoasFor(user.id).listForIndex();
  return NextResponse.json(rows);
});

// POST /api/agent/pessoas — cria/garante uma pessoa. Body: { nome*, aliases? }.
export const POST = withAgentAuth(async ({ user }, req) => {
  let body: { nome?: string; aliases?: string[] };
  try {
    body = (await (req as NextRequest).json()) as { nome?: string; aliases?: string[] };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nome = (body.nome ?? "").trim();
  if (!nome) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  if (nome.length > 80) {
    return NextResponse.json({ error: "nome muito longo (máx 80)" }, { status: 400 });
  }
  const aliases = Array.isArray(body.aliases)
    ? body.aliases.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim())
    : [];

  try {
    const created = await pessoasFor(user.id).create(nome, aliases);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

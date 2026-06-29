import { type NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Monta o link absoluto do convidado a partir dos headers (independe de
// NEXT_PUBLIC_BASE_URL, que pode não estar setada).
function linkFor(req: Request, token: string): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host ? `${proto}://${host}/q/${token}` : `/q/${token}`;
}

// GET /api/agent/quadros/[id]/convidados — lista convidados ativos (com link).
export const GET = withAgentAuth<Ctx>(async ({ user }, req, ctx) => {
  const { id } = await ctx.params;
  const convidados = await quadrosFor(user.id).convidados(id);
  return NextResponse.json(
    convidados.map((c) => ({
      id: c.id,
      nome: c.nome,
      link: linkFor(req, c.token),
      last_seen_at: c.last_seen_at,
      created_at: c.created_at,
    })),
  );
});

// POST /api/agent/quadros/[id]/convidados — cria um convidado (link passwordless).
// Body: { nome* }. Retorna { id, nome, link }.
export const POST = withAgentAuth<Ctx>(async ({ user }, req, ctx) => {
  const { id } = await ctx.params;
  let body: { nome?: string };
  try {
    body = (await (req as NextRequest).json()) as { nome?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nome = (body.nome ?? "").trim();
  if (!nome) {
    return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  }
  try {
    const r = await quadrosFor(user.id).criarConvidado(id, nome);
    return NextResponse.json(
      { id: r.id, nome: r.nome, link: linkFor(req, r.token) },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

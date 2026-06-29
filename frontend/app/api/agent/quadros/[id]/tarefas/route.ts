import { type NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/agent/quadros/[id]/tarefas — tarefas que estão no quadro.
export const GET = withAgentAuth<Ctx>(async ({ user }, _req, ctx) => {
  const { id } = await ctx.params;
  const tarefas = await quadrosFor(user.id).tarefas(id);
  return NextResponse.json(tarefas);
});

// POST /api/agent/quadros/[id]/tarefas — adiciona tarefas EXISTENTES ao quadro.
// Body: { tarefaIds: string[] }
export const POST = withAgentAuth<Ctx>(async ({ user }, req, ctx) => {
  const { id } = await ctx.params;
  let body: { tarefaIds?: string[] };
  try {
    body = (await (req as NextRequest).json()) as { tarefaIds?: string[] };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.tarefaIds) || body.tarefaIds.length === 0) {
    return NextResponse.json({ error: "tarefaIds (array) obrigatório" }, { status: 400 });
  }
  try {
    const result = await quadrosFor(user.id).adicionarTarefas(id, body.tarefaIds);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

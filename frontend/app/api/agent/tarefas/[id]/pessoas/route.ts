import { type NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { tarefasFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/agent/tarefas/[id]/pessoas — atrela UMA pessoa (aditivo).
// Body: { nome*, principal? }. Retorna a tarefa serializada.
export const POST = withAgentAuth<Ctx>(async ({ user }, req, ctx) => {
  const { id } = await ctx.params;
  let body: { nome?: string; principal?: boolean };
  try {
    body = (await (req as NextRequest).json()) as { nome?: string; principal?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nome = (body.nome ?? "").trim();
  if (!nome) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });

  try {
    const updated = await tarefasFor(user.id).atrelarPessoa(id, nome, !!body.principal);
    if (!updated) {
      return NextResponse.json({ error: "tarefa não encontrada" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

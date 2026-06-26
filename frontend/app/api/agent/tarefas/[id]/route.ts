import { type NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { tarefasFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

const VALID_STATUS = ["aberta", "em_andamento", "concluida", "cancelada"] as const;
const VALID_PRIORIDADE = ["baixa", "media", "alta", "urgente"] as const;
const VALID_ACAO = ["executar", "cobrar", "aguardar"] as const;

type Ctx = { params: Promise<{ id: string }> };

type PatchBody = Partial<{
  titulo: string;
  descricao: string | null;
  owner: string;
  acao: (typeof VALID_ACAO)[number];
  prazo: string | null;
  prazo_text: string | null;
  prioridade: (typeof VALID_PRIORIDADE)[number];
  status: (typeof VALID_STATUS)[number];
  frente_id: string | null;
  pessoas: { nome: string; principal?: boolean }[];
}>;

export const GET = withAgentAuth<Ctx>(async ({ user }, _req, ctx) => {
  const { id } = await ctx.params;
  const t = await tarefasFor(user.id).byId(id);
  if (!t) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  return NextResponse.json(t);
});

// PATCH (e PUT como alias) /api/agent/tarefas/[id] — edição parcial.
export const PATCH = withAgentAuth<Ctx>(async ({ user, origem }, req, ctx) => {
  const { id } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await (req as NextRequest).json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.acao !== undefined && !VALID_ACAO.includes(body.acao)) {
    return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  }
  if (body.prioridade !== undefined && !VALID_PRIORIDADE.includes(body.prioridade)) {
    return NextResponse.json({ error: "prioridade inválida" }, { status: 400 });
  }
  if (body.status !== undefined && !VALID_STATUS.includes(body.status)) {
    return NextResponse.json({ error: "status inválido" }, { status: 400 });
  }

  try {
    const updated = await tarefasFor(user.id).atualizar(id, body, origem);
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

export const PUT = PATCH;

export const DELETE = withAgentAuth<Ctx>(async ({ user }, _req, ctx) => {
  const { id } = await ctx.params;
  try {
    const deleted = await tarefasFor(user.id).remover(id);
    if (deleted === 0) {
      return NextResponse.json({ error: "tarefa não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
import { type NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

type PostBody = {
  tarefaIds: string[];
};

// GET /api/quadros/[id]/tarefas?candidates=1&q=... → tarefas do dono que ainda
// não estão no quadro (pro picker "adicionar existentes").
export const GET = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const url = new URL((req as NextRequest).url);
  const q = url.searchParams.get("q") ?? undefined;
  const candidatas = await quadrosFor(user.id).candidatas(id, q);
  return NextResponse.json({ candidatas });
});

export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!Array.isArray(body.tarefaIds)) {
    return NextResponse.json(
      { error: "tarefaIds deve ser um array" },
      { status: 400 },
    );
  }

  const result = await quadrosFor(user.id).adicionarTarefas(
    id,
    body.tarefaIds,
  );
  return NextResponse.json(result, { status: 201 });
});

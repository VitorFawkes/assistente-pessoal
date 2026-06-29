import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

type PostBody = {
  tarefaIds: string[];
};

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

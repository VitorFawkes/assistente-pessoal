import { NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; tid: string }> };

// DELETE /api/agent/quadros/[id]/tarefas/[tid] — remove a tarefa do quadro
// (não apaga a tarefa em si).
export const DELETE = withAgentAuth<Ctx>(async ({ user }, _req, ctx) => {
  const { id, tid } = await ctx.params;
  try {
    await quadrosFor(user.id).removerTarefa(id, tid);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
import { isTeamMode } from "@/lib/team-mode";
import { tirarDoProjeto } from "@/lib/projetos";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string; tid: string }> };

export const DELETE = withAuth<Ctx>(async (user, req, ctx) => {
  const { id, tid } = await ctx.params;
  if (isTeamMode()) {
    // Qualquer pessoa do projeto tira uma tarefa dele (a tarefa continua existindo).
    if (!(await tirarDoProjeto(user.id, id, tid))) {
      return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  }
  await quadrosFor(user.id).removerTarefa(id, tid);
  return new NextResponse(null, { status: 204 });
});

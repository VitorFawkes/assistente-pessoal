import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { novaTarefaDoMarketing, souDoMarketing, tarefasDoMarketing } from "@/lib/central-do-marketing";

export const dynamic = "force-dynamic";

// As tarefas do marketing para o Hub do Marketing no TTARS, como estão no Notion agora.
export const GET = withAuth(async (user) => {
  if (!(await souDoMarketing(user.id))) {
    return NextResponse.json({ error: "As tarefas do marketing são do time de marketing." }, { status: 403 });
  }
  return NextResponse.json(await tarefasDoMarketing(user.id));
});

// "Nova tarefa" do Hub: { titulo, descricao?, quem_email?, prazo?, prioridade?, projeto_id?, area? }.
export const POST = withAuth(async (user, req) => {
  if (!(await souDoMarketing(user.id))) {
    return NextResponse.json({ error: "As tarefas do marketing são do time de marketing." }, { status: 403 });
  }
  const r = await novaTarefaDoMarketing(user, await req.json().catch(() => null));
  return NextResponse.json(r.json, { status: r.status });
});

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { acessoTarefa } from "@/lib/equipe-compartilhado";
import { pedirEnvio } from "@/lib/notion-sync";
import { buDoWorkspace } from "@/lib/notion-mapa";

export const dynamic = "force-dynamic";

// "Mandar pro Notion da Paula": ação que a IA tirou da reunião com o nome de alguém do
// marketing só vai pro Notion quando alguém aperta (nunca sozinha).
export const POST = withAuth(async (user, req) => {
  let body: { tarefa_id?: string; notion_user_id?: string; workspace?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.tarefa_id) return NextResponse.json({ error: "qual ação?" }, { status: 400 });
  const acesso = await acessoTarefa(user.id, body.tarefa_id);
  if (!acesso) return NextResponse.json({ error: "ação não encontrada" }, { status: 404 });
  const ok = await pedirEnvio({
    tarefaId: body.tarefa_id,
    donoId: acesso.donoId,
    pedidoPor: user.id,
    notionUserId: body.notion_user_id ?? null,
    bu: buDoWorkspace(body.workspace),
  });
  if (!ok) return NextResponse.json({ error: "O Notion do marketing ainda não está ligado." }, { status: 409 });
  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { historicoDaTarefa, tarefaNaTela } from "@/lib/ttars-tela";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Uma ação aberta no painel do TTARS, venha de onde vier (busca, projeto, pessoa, Assistente):
// a tarefa do ponto de vista de quem vê, o papel dela e o histórico.
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const achada = await tarefaNaTela(user.id, id);
  if (!achada) {
    return NextResponse.json({ error: "Essa ação não existe mais ou não está com você." }, { status: 404 });
  }
  const historico = await historicoDaTarefa(achada.donoId, id, user.id);
  return NextResponse.json({ tarefa: achada.tarefa, papel: achada.papel, historico });
});

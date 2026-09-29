import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { UUID_RE } from "@/lib/hub";
import { comentariosDaTarefa, historicoDaTarefa, tarefaNaTela } from "@/lib/ttars-tela";
import { pessoasQueVeemATarefa, reuniaoDaTarefa } from "@/lib/quem-ve";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Uma ação aberta no painel do TTARS, venha de onde vier (busca, projeto, pessoa, Assistente):
// a tarefa do ponto de vista de quem vê, o papel dela, o histórico, os comentários e quem vê (pessoas marcadas; para quem criou,
// também como está a reunião de onde ela saiu).
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const achada = UUID_RE.test(id) ? await tarefaNaTela(user.id, id) : null;
  if (!achada) {
    return NextResponse.json({ error: "Essa ação não existe mais ou não está com você." }, { status: 404 });
  }
  const souDono = achada.papel === "dono";
  const [historico, comentarios, pessoas, reuniao] = await Promise.all([
    historicoDaTarefa(achada.donoId, id, user.id),
    comentariosDaTarefa(achada.donoId, id, user.id),
    pessoasQueVeemATarefa(achada.donoId, id),
    souDono && achada.tarefa.meeting_id ? reuniaoDaTarefa(achada.donoId, id) : Promise.resolve(null),
  ]);
  return NextResponse.json({
    tarefa: achada.tarefa,
    papel: achada.papel,
    historico,
    comentarios,
    quem_ve: {
      pessoas: pessoas.map(({ nome, email }) => ({ nome, email })),
      reuniao,
      pode_mudar: souDono,
    },
  });
});

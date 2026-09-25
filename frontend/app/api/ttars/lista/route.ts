import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { ABERTAS_LIMIT, tarefasFor, type Tarefa } from "@/lib/queries";
import { comProjetos, tarefasParaMim } from "@/lib/equipe-compartilhado";
import { ordenarPendencias } from "@/lib/compartilhar";

export const dynamic = "force-dynamic";

// Lista de ações para a tela do TTARS: as da pessoa + as que colegas passaram pra ela,
// cada uma já do ponto de vista de quem vê (mesma montagem da página inicial do Ações).
export const GET = withAuth(async (user) => {
  const [lista, contagens, paraMim] = await Promise.all([
    tarefasFor(user.id).recentes(),
    tarefasFor(user.id).contagens(),
    tarefasParaMim(user.id),
  ]);
  const juntas = paraMim.length
    ? [...(lista as unknown as Tarefa[]), ...paraMim].sort(ordenarPendencias)
    : (lista as unknown as Tarefa[]);
  const tarefas = await comProjetos(user.id, juntas);
  const totalAbertas =
    contagens.abertas + paraMim.filter((t) => t.status === "aberta" || t.status === "em_andamento").length;
  return NextResponse.json({
    eu: { id: user.id, nome: user.nome, email: user.email },
    tarefas,
    totalAbertas,
    limiteAbertas: ABERTAS_LIMIT,
  });
});

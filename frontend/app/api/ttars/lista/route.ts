import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { ABERTAS_LIMIT, tarefasFor, type Tarefa } from "@/lib/queries";
import { tarefasMarcadasParaMim, tarefasParaMim } from "@/lib/equipe-compartilhado";
import { ordenarPendencias } from "@/lib/compartilhar";
import { paraTela } from "@/lib/ttars-tela";

export const dynamic = "force-dynamic";

// Lista de ações para a tela do TTARS: as da pessoa + as que colegas passaram pra ela + as que marcaram para ela
// ver, cada uma já do ponto de vista de quem vê (mesma montagem da página inicial do Ações).
export const GET = withAuth(async (user) => {
  const [lista, contagens, paraMim, marcadas] = await Promise.all([
    tarefasFor(user.id).recentes(),
    tarefasFor(user.id).contagens(),
    tarefasParaMim(user.id),
    tarefasMarcadasParaMim(user.id),
  ]);
  const deOutros = [...paraMim, ...marcadas];
  const juntas = deOutros.length
    ? [...(lista as unknown as Tarefa[]), ...deOutros].sort(ordenarPendencias)
    : (lista as unknown as Tarefa[]);
  const tarefas = await paraTela(user.id, juntas);
  const totalAbertas =
    contagens.abertas + deOutros.filter((t) => t.status === "aberta" || t.status === "em_andamento" || t.status === "aguardando_aprovacao").length;
  return NextResponse.json({
    eu: { id: user.id, nome: user.nome, email: user.email },
    tarefas,
    totalAbertas,
    limiteAbertas: ABERTAS_LIMIT,
  });
});

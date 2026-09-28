import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { pessoasDaEquipe } from "@/lib/equipe-compartilhado";
import { podeTime, tarefasDoTime, timeIdValido, timesDasPessoas } from "@/lib/hub";
import { paraTela } from "@/lib/ttars-tela";
import { projetosParaTela } from "@/lib/projetos-tela";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Um time: as pessoas, as ações do time (de qualquer dono, do ponto de vista de quem vê) e os
// projetos do time. 404 para quem não é do time (nem administrador).
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!timeIdValido(id) || !(await podeTime(user.id, id))) {
    return NextResponse.json({ error: "Time não encontrado." }, { status: 404 });
  }
  const pessoas = await pessoasDaEquipe();
  const time = timesDasPessoas(pessoas).get(id);
  if (!time) return NextResponse.json({ error: "Time não encontrado." }, { status: 404 });
  const [tarefas, projetosIds] = await Promise.all([
    tarefasDoTime(user.id, id).then((t) => paraTela(user.id, t)),
    withTenant(user.id, (c) => c.query<{ quadro_id: string }>(`SELECT quadro_id FROM equipe_projetos_do_time($1)`, [id])).then((r) =>
      r.rows.map((x) => x.quadro_id),
    ),
  ]);
  return NextResponse.json({
    time,
    pessoas: pessoas.filter((p) => (p.times ?? []).some((t) => t?.id === id)),
    tarefas,
    projetos: await projetosParaTela(user.id, projetosIds),
  });
});

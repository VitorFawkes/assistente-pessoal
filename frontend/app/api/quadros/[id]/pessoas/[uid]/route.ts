import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { pessoasDoProjeto, tirarPessoa } from "@/lib/projetos";

type Ctx = { params: Promise<{ id: string; uid: string }> };

/** DELETE — tira a pessoa do projeto (quem criou tira qualquer um; os outros só saem). */
export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  if (!isTeamMode()) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  const { id, uid } = await ctx.params;
  const r = await tirarPessoa(user.id, id, uid);
  if (r === "nao_achou") return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  if (r === "nao_pode") {
    return NextResponse.json({ error: "Só quem criou o projeto tira outras pessoas." }, { status: 403 });
  }
  // Quem saiu não enxerga mais o projeto: devolve a lista só pra quem ficou.
  const saiu = uid === user.id;
  return NextResponse.json({ ok: true, saiu, pessoas: saiu ? [] : await pessoasDoProjeto(user.id, id) });
});

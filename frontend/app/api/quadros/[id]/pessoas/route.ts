import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { chamarPessoa, donoDoProjetoOuNulo, pessoasDoProjeto } from "@/lib/projetos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — pessoas do projeto (quem criou primeiro). */
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  if (!isTeamMode()) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  const { id } = await ctx.params;
  if (!(await donoDoProjetoOuNulo(user.id, id))) {
    return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ pessoas: await pessoasDoProjeto(user.id, id) });
});

/** POST { user_id } — chama um colega pro projeto. */
export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  if (!isTeamMode()) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  const { id } = await ctx.params;
  let body: { user_id?: string };
  try {
    body = (await (req as NextRequest).json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.user_id || typeof body.user_id !== "string") {
    return NextResponse.json({ error: "escolha uma pessoa" }, { status: 400 });
  }
  const r = await chamarPessoa(user.id, id, body.user_id);
  if (r === "nao_achou") return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  if (r === "nao_e_colega") {
    return NextResponse.json({ error: "Essa pessoa não está no Ações da equipe." }, { status: 400 });
  }
  return NextResponse.json({ pessoas: await pessoasDoProjeto(user.id, id) }, { status: 201 });
});

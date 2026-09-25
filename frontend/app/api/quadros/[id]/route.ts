import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
import { isTeamMode } from "@/lib/team-mode";
import { arquivarProjeto, atualizarProjeto } from "@/lib/projetos";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

type PatchBody = Partial<{
  nome: string;
  descricao: string | null;
  vista_padrao: "lista" | "timeline";
}>;

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (
    body.vista_padrao !== undefined &&
    body.vista_padrao !== "lista" &&
    body.vista_padrao !== "timeline"
  ) {
    return NextResponse.json({ error: "vista_padrao inválida" }, { status: 400 });
  }

  if (isTeamMode()) {
    const projeto = await atualizarProjeto(user.id, id, {
      nome: body.nome,
      descricao: body.descricao,
      vista_padrao: body.vista_padrao,
    });
    if (!projeto) return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
    return NextResponse.json(projeto);
  }

  const quadro = await quadrosFor(user.id).atualizar(
    id,
    body.nome !== undefined ? body.nome : undefined,
    body.descricao !== undefined ? body.descricao : undefined,
    body.vista_padrao !== undefined ? body.vista_padrao : undefined,
  );

  if (!quadro) {
    return NextResponse.json({ error: "quadro não encontrado" }, { status: 404 });
  }

  return NextResponse.json(quadro);
});

export const DELETE = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (isTeamMode()) {
    const r = await arquivarProjeto(user.id, id);
    if (r === "nao_achou") return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
    if (r === "nao_e_dono") {
      return NextResponse.json({ error: "Só quem criou o projeto pode arquivar." }, { status: 403 });
    }
    return new NextResponse(null, { status: 204 });
  }
  await quadrosFor(user.id).arquivar(id);
  return new NextResponse(null, { status: 204 });
});

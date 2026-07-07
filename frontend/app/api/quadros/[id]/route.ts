import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
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
  await quadrosFor(user.id).arquivar(id);
  return new NextResponse(null, { status: 204 });
});

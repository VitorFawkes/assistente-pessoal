import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

type PostBody = {
  nome: string;
};

export const GET = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const convidados = await quadrosFor(user.id).convidados(id);
  return NextResponse.json({ convidados });
});

export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.nome || typeof body.nome !== "string") {
    return NextResponse.json(
      { error: "nome é obrigatório" },
      { status: 400 },
    );
  }

  const result = await quadrosFor(user.id).criarConvidado(id, body.nome);
  return NextResponse.json(result, { status: 201 });
});

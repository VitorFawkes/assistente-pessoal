import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

type PostBody = {
  nome?: string;
  nomes?: string[];
};

const MAX_NOMES = 100;

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

  // Lote: { nomes: string[] }
  if (Array.isArray(body.nomes)) {
    if (!body.nomes.every((n) => typeof n === "string")) {
      return NextResponse.json(
        { error: "nomes deve ser uma lista de strings" },
        { status: 400 },
      );
    }
    if (body.nomes.length > MAX_NOMES) {
      return NextResponse.json(
        { error: `no máximo ${MAX_NOMES} nomes por vez` },
        { status: 400 },
      );
    }
    const convidados = await quadrosFor(user.id).criarConvidados(id, body.nomes);
    if (convidados.length === 0) {
      return NextResponse.json(
        { error: "nenhum nome válido" },
        { status: 400 },
      );
    }
    return NextResponse.json({ convidados }, { status: 201 });
  }

  // Singular: { nome: string }
  if (!body.nome || typeof body.nome !== "string") {
    return NextResponse.json(
      { error: "nome é obrigatório" },
      { status: 400 },
    );
  }

  const result = await quadrosFor(user.id).criarConvidado(id, body.nome);
  return NextResponse.json(result, { status: 201 });
});

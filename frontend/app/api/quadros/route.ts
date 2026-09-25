import { withAuth } from "@/lib/auth";
import { quadrosFor } from "@/lib/quadros";
import { isTeamMode } from "@/lib/team-mode";
import { listarProjetos } from "@/lib/projetos";
import { NextResponse } from "next/server";

type Ctx = unknown;

export const GET = withAuth<Ctx>(async (user) => {
  // Equipe: os projetos da pessoa são os dela e os em que ela foi chamada.
  const quadros = isTeamMode() ? await listarProjetos(user.id) : await quadrosFor(user.id).list();
  return NextResponse.json({ quadros });
});

export const POST = withAuth<Ctx>(async (user, req) => {
  let body: { nome: string; descricao?: string };
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

  const quadro = await quadrosFor(user.id).criar(body.nome, body.descricao);
  return NextResponse.json(quadro, { status: 201 });
});

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { listarProjetos } from "@/lib/projetos";

export const dynamic = "force-dynamic";

// Projetos de quem pede (os dele e os em que foi chamado), com as pessoas de cada um.
export const GET = withAuth(async (user) => {
  const projetos = await listarProjetos(user.id);
  return NextResponse.json({
    projetos: projetos.map((p) => ({
      id: p.id,
      nome: p.nome,
      descricao: (p as { descricao?: string | null }).descricao ?? null,
      n_tarefas: p.n_tarefas,
      pessoas: p.pessoas,
      sou_dono: p.sou_dono,
    })),
  });
});

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { pessoasDaEquipe } from "@/lib/equipe-compartilhado";

export const dynamic = "force-dynamic";

// Quem pode receber uma ação: todas as pessoas da Welcome no TTARS (fora "Parceiros").
// Time serve pra agrupar/filtrar, nunca como a lista de gente.
export const GET = withAuth(async (user) => {
  const pessoas = await pessoasDaEquipe();
  const eu = user.email ? pessoas.find((p) => p.email === user.email!.toLowerCase()) : undefined;
  return NextResponse.json({
    eu: { id: user.id, nome: user.nome, email: user.email },
    pessoas: eu ? pessoas : [{ id: user.id, email: (user.email || "").toLowerCase(), nome: user.nome, organizacao: "", times: [], usa_acoes: true }, ...pessoas],
  });
});

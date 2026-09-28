import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { projetosParaTela } from "@/lib/projetos-tela";

export const dynamic = "force-dynamic";

// Projetos de quem pede (os dele, os em que foi chamado e os dos times dele), com as pessoas,
// os números, o time e o objetivo de cada um.
export const GET = withAuth(async (user) => {
  return NextResponse.json({ projetos: await projetosParaTela(user.id) });
});

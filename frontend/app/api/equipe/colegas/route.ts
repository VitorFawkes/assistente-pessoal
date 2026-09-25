import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { colegasDe } from "@/lib/equipe-compartilhado";

export const dynamic = "force-dynamic";

/** GET — pessoas da equipe que podem receber tarefa ou entrar num projeto (inclui quem pede). */
export const GET = withAuth(async (user) => {
  if (!isTeamMode()) return NextResponse.json({ colegas: [] });
  return NextResponse.json({ eu: user.id, colegas: await colegasDe(user.id) });
});

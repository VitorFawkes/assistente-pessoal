import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";
import { meetingSubject } from "@/lib/meeting-label";

export const dynamic = "force-dynamic";

// Reuniões para as telas do Ações dentro do TTARS: as minhas e as que colegas abriram pra mim.
export const GET = withAuth(async (user) => {
  const { minhas, daEquipe } = await meetingsFor(user.id).listParaTtars();
  const comRotulo = <T extends { nome: string | null; summary: string | null }>(m: T) => {
    const { summary, ...resto } = m;
    return { ...resto, rotulo: meetingSubject(summary, m.nome) || "Reunião" };
  };
  return NextResponse.json({ minhas: minhas.map(comRotulo), daEquipe: daEquipe.map(comRotulo) });
});

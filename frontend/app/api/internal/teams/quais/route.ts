import { NextResponse } from "next/server";
import { chaveDoTtarsConfere, quais } from "@/lib/teams-receber";
import { lerCandidato } from "@/lib/teams-pedido";
import type { Candidato } from "@/lib/teams";

export const dynamic = "force-dynamic";

// O TTARS (rotina teams-para-acoes, a cada 5 min) pergunta quais reuniões do Teams recém-acabadas
// o Ações quer. Só depois ele busca a transcrição delas.
export async function POST(req: Request) {
  if (!chaveDoTtarsConfere(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const corpo = (await req.json().catch(() => null)) as { reunioes?: unknown } | null;
  if (!corpo || !Array.isArray(corpo.reunioes) || corpo.reunioes.length > 500) {
    return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  }
  const candidatos = corpo.reunioes.map(lerCandidato).filter((c): c is Candidato => !!c);
  return NextResponse.json({ respostas: await quais(candidatos) });
}

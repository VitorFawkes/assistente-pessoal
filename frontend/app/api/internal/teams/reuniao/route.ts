import { NextResponse } from "next/server";
import { chaveDoTtarsConfere, receber } from "@/lib/teams-receber";
import { lerCandidato, lerLegendas } from "@/lib/teams-pedido";

export const dynamic = "force-dynamic";

// O TTARS entrega a transcrição (com o nome de quem fala) de uma reunião que o Ações quis.
export async function POST(req: Request) {
  if (!chaveDoTtarsConfere(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const candidato = lerCandidato(corpo);
  const legendas = lerLegendas(corpo?.legendas);
  if (!candidato || !legendas) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  try {
    return NextResponse.json(await receber({ ...candidato, legendas }));
  } catch (e) {
    console.error("[teams] receber", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "não deu para criar a reunião" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { chaveDoTtarsConfere, chegando } from "@/lib/teams-receber";
import { lerCandidato } from "@/lib/teams-pedido";

export const dynamic = "force-dynamic";

// O TTARS avisa que o Teams já tem a transcrição de uma reunião que o Ações quis, mas ela ainda
// fecha: a reunião nasce já, como "chegando do Teams", e a transcrição entra nela depois.
export async function POST(req: Request) {
  if (!chaveDoTtarsConfere(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const candidato = lerCandidato(await req.json().catch(() => null));
  if (!candidato) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  try {
    return NextResponse.json(await chegando(candidato));
  } catch (e) {
    console.error("[teams] chegando", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "não deu para criar a reunião" }, { status: 500 });
  }
}

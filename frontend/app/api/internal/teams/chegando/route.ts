import { NextResponse } from "next/server";
import { chaveDoTtarsConfere, chegando, largar } from "@/lib/teams-receber";
import { lerCandidato, lerNoTeams } from "@/lib/teams-pedido";

export const dynamic = "force-dynamic";

// O TTARS avisa que uma reunião que o Ações quis está sendo gravada no Teams (ou já parou e o Teams
// fecha a transcrição): a reunião nasce já, como "chegando do Teams", e a transcrição entra nela
// depois. `largar`: parou há tempo e o Teams não fez a transcrição, a chegando sai.
export async function POST(req: Request) {
  if (!chaveDoTtarsConfere(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const corpo = await req.json().catch(() => null);
  const candidato = lerCandidato(corpo);
  if (!candidato) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  try {
    if ((corpo as { largar?: unknown }).largar === true) return NextResponse.json(await largar(candidato));
    return NextResponse.json(await chegando(candidato, lerNoTeams(corpo)));
  } catch (e) {
    console.error("[teams] chegando", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "não deu para criar a reunião" }, { status: 500 });
  }
}

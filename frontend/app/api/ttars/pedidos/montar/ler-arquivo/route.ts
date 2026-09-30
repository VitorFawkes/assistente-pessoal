import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { lerArquivoDePerguntas } from "@/lib/pedidos-ler";

export const dynamic = "force-dynamic";

// Arquivo com as perguntas → rascunho de formulário (IA; sem IA, uma pergunta por linha do texto).
// Corpo: { nome_arquivo, texto?, imagem_base64?, mime? } (até 10 MB). O arquivo não é guardado.
export const POST = withAuth(async (user, req) => {
  const corpo = await req.json().catch(() => null);
  if (!corpo) return NextResponse.json({ error: "O arquivo não chegou inteiro. Tente um menor.", erro: "O arquivo não chegou inteiro. Tente um menor." }, { status: 400 });
  const r = await lerArquivoDePerguntas(user, corpo);
  return NextResponse.json(r.json, { status: r.status });
});

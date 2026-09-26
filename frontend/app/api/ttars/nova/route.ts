import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { criarPelaCaixa } from "@/lib/nova-acao";

export const dynamic = "force-dynamic";

// Caixa "Nova ação" das telas do Ações no TTARS. Corpo: { texto, quem_email?, prazo? (AAAA-MM-DD),
// projeto_id?, meeting_id?, workspace? }. Devolve a ação criada do ponto de vista de quem criou.
export const POST = withAuth(async (user, req) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.texto !== "string") {
    return NextResponse.json({ error: "Escreva o que precisa ser feito." }, { status: 400 });
  }
  const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const r = await criarPelaCaixa(user, {
    texto: body.texto,
    quem_email: txt(body.quem_email),
    prazo: txt(body.prazo),
    projeto_id: txt(body.projeto_id),
    meeting_id: txt(body.meeting_id),
    workspace: txt(body.workspace),
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
  return NextResponse.json({ tarefa: r.tarefa, aviso: r.aviso }, { status: 201 });
});

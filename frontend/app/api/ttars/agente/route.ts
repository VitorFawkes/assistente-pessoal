import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { conversar, type Contexto, type Fala } from "@/lib/agente";
import { IaIndisponivel } from "@/lib/ia";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Assistente do Ações nas telas do TTARS. Corpo: { falas: [{quem, texto}], contexto?: {tela,
// projeto_id, reuniao_id, pessoa_email, tarefa_id}, workspace? }. A conversa mora no navegador.
export const POST = withAuth(async (user, req) => {
  const body = (await req.json().catch(() => null)) as {
    falas?: Fala[];
    contexto?: Contexto;
    workspace?: string;
  } | null;
  if (!body || !Array.isArray(body.falas)) {
    return NextResponse.json({ error: "Escreva uma pergunta." }, { status: 400 });
  }
  const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const c = body.contexto ?? {};
  try {
    const r = await conversar(user, req, {
      falas: body.falas,
      contexto: {
        tela: txt(c.tela),
        projeto_id: txt(c.projeto_id),
        reuniao_id: txt(c.reuniao_id),
        pessoa_email: txt(c.pessoa_email),
        tarefa_id: txt(c.tarefa_id),
      },
      workspace: txt(body.workspace),
    });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof IaIndisponivel) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("[agente]", e);
    return NextResponse.json({ error: "O Assistente não conseguiu responder agora. Tente de novo." }, { status: 500 });
  }
});

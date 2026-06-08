import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_PRIORIDADE = ["baixa", "media", "alta", "urgente"] as const;
const VALID_ACAO = ["executar", "cobrar", "aguardar"] as const;

type PostBody = Partial<{
  titulo: string;
  descricao: string | null;
  owner: string;
  acao: (typeof VALID_ACAO)[number];
  prazo: string | null;
  prazo_text: string | null;
  prioridade: (typeof VALID_PRIORIDADE)[number];
  frente_id: string | null;
  pessoas: { nome: string; principal?: boolean }[];
}>;

// POST /api/tarefas — cria uma tarefa manual (não veio de reunião).
// meeting_id fica NULL; vira o "controle de tarefas" unificado.
export const POST = withAuth(async (user, req) => {
  let body: PostBody;
  try {
    body = (await (req as NextRequest).json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const titulo = (body.titulo ?? "").trim();
  if (!titulo) {
    return NextResponse.json({ error: "título obrigatório" }, { status: 400 });
  }

  const acao = body.acao ?? "executar";
  if (!VALID_ACAO.includes(acao)) {
    return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  }

  const prioridade = body.prioridade ?? "media";
  if (!VALID_PRIORIDADE.includes(prioridade)) {
    return NextResponse.json({ error: "prioridade inválida" }, { status: 400 });
  }

  const owner = (body.owner ?? "").trim() || "vitor";

  try {
    const { tarefasFor } = await import("@/lib/queries");
    const created = await tarefasFor(user.id).criar(
      {
        titulo,
        descricao: body.descricao ?? null,
        owner,
        acao,
        prazo: body.prazo ?? null,
        prazo_text: body.prazo_text ?? null,
        prioridade,
        frente_id: body.frente_id ?? null,
        pessoas: Array.isArray(body.pessoas) ? body.pessoas : undefined,
      },
      { origem: "manual" },
    );
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

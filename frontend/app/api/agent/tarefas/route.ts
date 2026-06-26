import { type NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/auth";
import { tarefasFor } from "@/lib/queries";

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
  pessoas: { nome: string; principal?: boolean }[] | string[];
}>;

// GET /api/agent/tarefas?status=&owner=&prioridade=&acao=&no_plano=&q=
// Lista tarefas do user (RLS). `q` faz busca por título/descrição/owner.
export const GET = withAgentAuth(async ({ user }, req) => {
  const p = new URL((req as NextRequest).url).searchParams;
  const q = (p.get("q") || "").trim();

  let rows = q
    ? await tarefasFor(user.id).buscar(q)
    : await tarefasFor(user.id).recentes();

  const status = p.get("status");
  const owner = p.get("owner");
  const prioridade = p.get("prioridade");
  const acao = p.get("acao");
  const noPlano = p.get("no_plano");

  if (status) rows = rows.filter((t) => t.status === status);
  if (prioridade) rows = rows.filter((t) => t.prioridade === prioridade);
  if (acao) rows = rows.filter((t) => t.acao === acao);
  if (owner) rows = rows.filter((t) => (t.owner || "").toLowerCase() === owner.toLowerCase());
  if (noPlano === "true") rows = rows.filter((t) => t.no_plano);

  return NextResponse.json(rows);
});

// POST /api/agent/tarefas — cria tarefa. Body: { titulo*, descricao?, owner?, acao?,
// prazo?, prazo_text?, prioridade?, frente_id?, pessoas? }
export const POST = withAgentAuth(async ({ user, origem }, req) => {
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
      { origem },
    );
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

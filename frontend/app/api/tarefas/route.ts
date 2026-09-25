import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getOwnerSlug } from "@/lib/owner-slug";
import { withTenant } from "@/lib/db";
import { isTeamMode } from "@/lib/team-mode";
import { resolverDono } from "@/lib/compartilhar";
import { colegasDe, garantirColegaDoTtars } from "@/lib/equipe-compartilhado";

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
  /** Equipe: nasce já passada pra este colega. */
  responsavel_user_id: string | null;
  /** Equipe: pessoa do TTARS pelo e-mail (ganha conta aqui se ainda não tem). */
  responsavel_email: string;
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

  let acao = body.acao ?? "executar";
  if (!VALID_ACAO.includes(acao)) {
    return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  }

  const prioridade = body.prioridade ?? "media";
  if (!VALID_PRIORIDADE.includes(prioridade)) {
    return NextResponse.json({ error: "prioridade inválida" }, { status: 400 });
  }

  let owner = (body.owner ?? "").trim() || getOwnerSlug();
  let pessoas = Array.isArray(body.pessoas) ? body.pessoas : undefined;
  let responsavel: string | null = null;

  if (isTeamMode() && typeof body.responsavel_email === "string" && body.responsavel_email.trim()) {
    const c = await garantirColegaDoTtars(body.responsavel_email);
    if (!c) return NextResponse.json({ error: "Essa pessoa não está na lista do TTARS." }, { status: 400 });
    body.responsavel_user_id = c.id;
  }

  // Equipe: dono que é colega (escolhido ou digitado) → a tarefa já nasce na lista dele.
  if (isTeamMode() && (body.owner !== undefined || body.responsavel_user_id)) {
    const r = resolverDono(
      { owner: body.owner, acao: body.acao, responsavel_user_id: body.responsavel_user_id ?? undefined },
      { donoId: user.id, colegas: await colegasDe(user.id), slug: getOwnerSlug() },
    );
    if (r.erro) return NextResponse.json({ error: r.erro }, { status: 400 });
    owner = r.owner ?? owner;
    acao = r.acao ?? acao;
    responsavel = r.responsavel ?? null;
    if (!pessoas && owner !== getOwnerSlug()) pessoas = [{ nome: owner, principal: true }];
  }

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
        pessoas,
      },
      { origem: "manual" },
    );
    if (responsavel) {
      await withTenant(user.id, (c) =>
        c.query("UPDATE tarefas SET responsavel_user_id = $1 WHERE id = $2", [responsavel, created.id]),
      );
      created.responsavel_user_id = responsavel;
    }
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

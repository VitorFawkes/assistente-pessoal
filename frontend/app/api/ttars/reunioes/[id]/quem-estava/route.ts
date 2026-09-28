import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { UUID_RE } from "@/lib/hub";
import { mudarQuemEstava } from "@/lib/quem-ve";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Quem gravou marca quem estava na reunião e não falou (POST) ou tira quem não estava (DELETE). Corpo: { email }.
// Quem entrou pela voz sai trocando a voz em "Quem falou".
async function mudar(userId: string, req: Request, ctx: Ctx, acao: "por" | "tirar") {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { email?: unknown } | null;
  if (typeof b?.email !== "string" || !b.email.trim()) return NextResponse.json({ error: "Escolha a pessoa." }, { status: 400 });
  const r = await mudarQuemEstava(userId, id, b.email, acao);
  if (r === "nao_achou") return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
  if (r === "nao_e_dono") return NextResponse.json({ error: "Só quem gravou muda quem estava." }, { status: 403 });
  if (r === "pessoa") return NextResponse.json({ error: "Essa pessoa não está na lista da Welcome." }, { status: 400 });
  if (r === "segue_a_voz") return NextResponse.json({ error: "Essa pessoa entrou pela voz: troque a voz em Quem falou." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export const POST = withAuth<Ctx>((user, req, ctx) => mudar(user.id, req, ctx, "por"));
export const DELETE = withAuth<Ctx>((user, req, ctx) => mudar(user.id, req, ctx, "tirar"));

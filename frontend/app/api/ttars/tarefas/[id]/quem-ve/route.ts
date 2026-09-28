import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { mudarQuemVeDaTarefa, type MudancaDeQuemVe } from "@/lib/quem-ve";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Quem vê a ação (só quem criou muda). Corpo: { pessoas?: e-mails (a lista inteira), juntar?/tirar?: e-mails (várias
// ações de uma vez), time_id?: time ou null }. Pessoa marcada vê e mexe na ação (não apaga nem muda quem vê); o time também.
export const PUT = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  const emails = (v: unknown) => (Array.isArray(v) ? v.filter((e): e is string => typeof e === "string").slice(0, 50) : undefined);
  const m: MudancaDeQuemVe = { pessoas: emails(b.pessoas), juntar: emails(b.juntar), tirar: emails(b.tirar) };
  if (b.time_id !== undefined) m.time_id = typeof b.time_id === "string" ? b.time_id : null;
  if (m.pessoas === undefined && m.juntar === undefined && m.tirar === undefined && m.time_id === undefined) {
    return NextResponse.json({ error: "Nada para mudar." }, { status: 400 });
  }
  const r = await mudarQuemVeDaTarefa(user.id, id, m);
  if (r === "nao_achou") return NextResponse.json({ error: "Essa ação não existe mais ou não está com você." }, { status: 404 });
  if (r === "so_quem_criou") return NextResponse.json({ error: "Só quem criou a ação muda quem vê." }, { status: 403 });
  if (r === "time") return NextResponse.json({ error: "Você não está nesse time." }, { status: 400 });
  if (r === "pessoa") return NextResponse.json({ error: "Essa pessoa não está na lista da Welcome." }, { status: 400 });
  return NextResponse.json({ ok: true });
});

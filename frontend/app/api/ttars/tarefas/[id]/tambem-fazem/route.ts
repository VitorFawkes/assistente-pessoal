import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { mudarTambemFazem } from "@/lib/quem-ve";
import { travaDoPedido } from "@/lib/pedidos-trava";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Quem também faz a ação (subresponsáveis). Corpo: { pessoas: e-mails (a lista inteira) }. Quem criou e quem faz mudam.
export const PUT = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !Array.isArray(b.pessoas)) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  const emails = b.pessoas.filter((e): e is string => typeof e === "string");
  const trava = await travaDoPedido(user.id, [id], { campos: ["tambem_fazem"] });
  if (trava) return NextResponse.json({ error: trava.erro }, { status: trava.status });
  const r = await mudarTambemFazem(user.id, id, emails);
  if (r === "nao_achou") return NextResponse.json({ error: "Essa ação não existe mais ou não está com você." }, { status: 404 });
  if (r === "so_quem_cuida") return NextResponse.json({ error: "Só quem criou ou quem faz muda quem também faz." }, { status: 403 });
  if (r === "pessoa") return NextResponse.json({ error: "Essa pessoa não está na lista da Welcome." }, { status: 400 });
  return NextResponse.json({ ok: true });
});

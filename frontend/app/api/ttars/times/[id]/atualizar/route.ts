import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { atualizarTimeDoTtars } from "@/lib/ttars-auth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Depois que o time muda no TTARS (nome, quem está), a tela do TTARS pede para o Ações refazer o time na hora.
// O login do TTARS de quem pede vem no corpo ({ token }): o time é lido no próprio TTARS com ele (nada é guardado).
export const POST = withAuth<Ctx>(async (_user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Time inválido." }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof b?.token === "string" ? b.token.trim() : "";
  if (!token) return NextResponse.json({ error: "Entre de novo no TTARS." }, { status: 401 });
  const t = await atualizarTimeDoTtars(token, id);
  if (!t) return NextResponse.json({ error: "O TTARS não devolveu esse time." }, { status: 404 });
  return NextResponse.json({ ok: true, time: { id: t.id, nome: t.nome, pessoas: t.membros.length } });
});

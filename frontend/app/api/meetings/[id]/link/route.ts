import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

/** POST — liga o link de leitura da reunião. Devolve o token (o mesmo, se já existia). */
export const POST = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const token = await meetingsFor(user.id).criarLink(id);
  if (!token) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  return NextResponse.json({ token });
});

/** DELETE — desliga o link. Quem tiver a URL para de conseguir abrir. */
export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const ok = await meetingsFor(user.id).revogarLink(id);
  if (!ok) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
});

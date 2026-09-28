import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { UUID_RE } from "@/lib/hub";
import { lerLista } from "@/lib/listas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Mudar ou apagar uma lista salva (só a dona; o RLS já fecha na conta dela).
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Lista não encontrada." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  const lido = lerLista(b, false);
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const d = lido.dados;
  const sets: string[] = [];
  const valores: unknown[] = [];
  const por = (col: string, v: unknown) => {
    valores.push(v);
    sets.push(`${col} = $${valores.length}`);
  };
  if (d.nome !== undefined) por("nome", d.nome);
  if (d.filtro !== undefined) por("filtro", JSON.stringify(d.filtro));
  if (d.ordem !== undefined) por("ordem", d.ordem);
  if (d.vista !== undefined) por("vista", d.vista);
  if (!sets.length) return NextResponse.json({ error: "Nada para mudar." }, { status: 400 });
  valores.push(id);
  const r = await withTenant(user.id, (c) => c.query(`UPDATE acoes_listas SET ${sets.join(", ")}, updated_at = now() WHERE id = $${valores.length}`, valores));
  if (!r.rowCount) return NextResponse.json({ error: "Lista não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Lista não encontrada." }, { status: 404 });
  const r = await withTenant(user.id, (c) => c.query(`DELETE FROM acoes_listas WHERE id = $1`, [id]));
  if (!r.rowCount) return NextResponse.json({ error: "Lista não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
});

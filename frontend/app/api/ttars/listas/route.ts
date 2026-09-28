import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { listasDe, type ListaSalva } from "@/lib/hub";
import { lerLista } from "@/lib/listas";

export const dynamic = "force-dynamic";

// As listas salvas de quem pede (o filtro que ela montou vira item do menu do Ações).
export const GET = withAuth(async (user) => {
  return NextResponse.json({ listas: await listasDe(user.id) });
});

export const POST = withAuth(async (user, req) => {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  const lido = lerLista(b, true);
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const d = lido.dados;
  const r = await withTenant(user.id, (c) =>
    c.query<ListaSalva>(
      `INSERT INTO acoes_listas (user_id, nome, onde, filtro, ordem, vista) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text, nome, onde, filtro, ordem, vista`,
      [user.id, d.nome, d.onde, JSON.stringify(d.filtro ?? {}), d.ordem ?? null, d.vista ?? null],
    ),
  );
  return NextResponse.json({ lista: r.rows[0] }, { status: 201 });
});

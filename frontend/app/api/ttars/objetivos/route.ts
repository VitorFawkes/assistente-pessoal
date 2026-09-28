import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { objetivosVisiveis } from "@/lib/hub";
import { lerObjetivo } from "@/lib/objetivos";

export const dynamic = "force-dynamic";

// Objetivos que quem pede vê (os dele, os do time dele e os abertos a toda a Welcome), com os
// números sobre as mesmas ações que a tela mostra.
export const GET = withAuth(async (user) => {
  return NextResponse.json({ objetivos: await objetivosVisiveis(user.id) });
});

export const POST = withAuth(async (user, req) => {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  const lido = await lerObjetivo(user.id, b, false);
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const d = lido.dados;
  const time = d.visibilidade === "time" ? (d.time_id ?? null) : null;
  if (d.visibilidade === "time" && !time) return NextResponse.json({ error: "Escolha o time que vai ver o objetivo." }, { status: 400 });
  const r = await withTenant(user.id, (c) =>
    c.query<{ id: string }>(
      `INSERT INTO objetivos (user_id, nome, como_medir, prazo, visibilidade, time_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
      [user.id, d.nome, d.como_medir ?? null, d.prazo ?? null, d.visibilidade, time],
    ),
  );
  return NextResponse.json({ id: r.rows[0]!.id }, { status: 201 });
});

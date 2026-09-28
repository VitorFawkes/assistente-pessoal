import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

type PostBody = {
  nome: string;
  onde: string;
  filtro?: Record<string, unknown>;
  ordem?: string;
  vista?: string;
};

export const GET = withAuth(async (user) => {
  try {
    const listas = await withTenant(user.id, async (c) => {
      const r = await c.query<{
        id: string;
        nome: string;
        onde: string;
        filtro: Record<string, unknown> | null;
        ordem: string | null;
        vista: string | null;
      }>(
        `SELECT id, nome, onde, filtro, ordem, vista FROM acoes_listas
          WHERE user_id = $1
          ORDER BY updated_at DESC`,
        [user.id],
      );
      return r.rows;
    });

    return NextResponse.json({ listas });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

export const POST = withAuth(async (user, req) => {
  try {
    const body: PostBody = await req.json();

    if (!body.nome || body.nome.trim().length === 0 || body.nome.length > 80) {
      return NextResponse.json({ error: "nome inválido" }, { status: 400 });
    }

    if (!body.onde || !body.onde.match(/^(minhas|time:t-[a-z0-9-]+|projeto:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|objetivo:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)) {
      return NextResponse.json({ error: "onde inválido" }, { status: 400 });
    }

    const lista = await withTenant(user.id, async (c) => {
      const r = await c.query<{
        id: string;
        nome: string;
        onde: string;
        filtro: Record<string, unknown> | null;
        ordem: string | null;
        vista: string | null;
      }>(
        `INSERT INTO acoes_listas (user_id, nome, onde, filtro, ordem, vista, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         RETURNING id, nome, onde, filtro, ordem, vista`,
        [user.id, body.nome.trim(), body.onde, body.filtro ?? null, body.ordem ?? null, body.vista ?? null],
      );
      return r.rows[0];
    });

    return NextResponse.json({ lista }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

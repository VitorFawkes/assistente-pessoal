import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

type PatchBody = {
  nome?: string;
  filtro?: Record<string, unknown> | null;
  ordem?: string | null;
  vista?: string | null;
};

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  try {
    const { id } = await ctx.params;
    const body: PatchBody = await req.json();

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    if (body.nome !== undefined && (body.nome.length === 0 || body.nome.length > 80)) {
      return NextResponse.json({ error: "nome inválido" }, { status: 400 });
    }

    const sets: string[] = [];
    const values: unknown[] = [id, user.id];

    if (body.nome !== undefined) {
      sets.push(`nome = $${values.length + 1}`);
      values.push(body.nome.trim());
    }

    if (body.filtro !== undefined) {
      sets.push(`filtro = $${values.length + 1}`);
      values.push(body.filtro ?? null);
    }

    if (body.ordem !== undefined) {
      sets.push(`ordem = $${values.length + 1}`);
      values.push(body.ordem ?? null);
    }

    if (body.vista !== undefined) {
      sets.push(`vista = $${values.length + 1}`);
      values.push(body.vista ?? null);
    }

    if (!sets.length) {
      return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
    }

    sets.push("updated_at = now()");

    const resultado = await withTenant(user.id, async (c) => {
      const r = await c.query<{ id: string }>(
        `UPDATE acoes_listas SET ${sets.join(", ")}
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        values,
      );
      return r.rows[0];
    });

    if (!resultado) {
      return NextResponse.json({ error: "lista não encontrada" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  try {
    const { id } = await ctx.params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const resultado = await withTenant(user.id, async (c) => {
      const r = await c.query<{ id: string }>(
        `DELETE FROM acoes_listas WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, user.id],
      );
      return r.rows[0];
    });

    if (!resultado) {
      return NextResponse.json({ error: "lista não encontrada" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

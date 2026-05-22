import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PatchBody = Partial<{
  nome: string;
  aliases: string[];
  notas: string | null;
}>;

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await (req as NextRequest).json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  if (body.nome !== undefined) {
    const nome = String(body.nome).trim();
    if (!nome) return NextResponse.json({ error: "nome vazio" }, { status: 400 });
    if (nome.length > 80) return NextResponse.json({ error: "nome muito longo" }, { status: 400 });
    push("nome", nome);
  }
  if (body.aliases !== undefined) {
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim())
      : [];
    push("aliases", aliases);
  }
  if (body.notas !== undefined) {
    const notas = typeof body.notas === "string" ? body.notas.trim() || null : null;
    push("notas", notas);
  }

  if (!sets.length) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
  }

  values.push(id);
  const sql = `UPDATE pessoas SET ${sets.join(", ")} WHERE id = $${values.length}
               RETURNING id, nome, aliases, is_vitor, notas,
                         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                         to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at`;

  try {
    const rows = await withTenant(user.id, async (db) => {
      const r = await db.query(sql, values);
      return r.rows;
    });
    if (!rows.length) return NextResponse.json({ error: "pessoa não encontrada" }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  try {
    const result = await withTenant(user.id, async (db) => {
      const r = await db.query<{ id: string; is_vitor: boolean }>(
        "SELECT id, is_vitor FROM pessoas WHERE id = $1",
        [id],
      );
      if (!r.rows.length) return { found: false as const };
      if (r.rows[0].is_vitor) return { found: true as const, blocked: true as const };
      await db.query("DELETE FROM pessoas WHERE id = $1", [id]);
      return { found: true as const, blocked: false as const, deleted: id };
    });
    if (!result.found) return NextResponse.json({ error: "pessoa não encontrada" }, { status: 404 });
    if (result.blocked) return NextResponse.json({ error: "não pode deletar Vitor (dono)" }, { status: 400 });
    return NextResponse.json({ ok: true, deleted: result.deleted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

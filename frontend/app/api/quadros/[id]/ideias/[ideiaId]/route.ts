import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; ideiaId: string }> };

/** PATCH — muda o texto, ou marca que a ideia virou tarefa. */
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id, ideiaId } = await ctx.params;
  let body: { texto?: string; tarefa_id?: string };
  try {
    body = (await (req as NextRequest).json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  await withTenant(user.id, async (c) => {
    if (body.texto !== undefined) {
      await c.query(
        `UPDATE quadro_ideias SET texto = $1, atualizado_em = now() WHERE id = $2 AND quadro_id = $3`,
        [body.texto.trim().slice(0, 2000), ideiaId, id],
      );
    }
    if (body.tarefa_id) {
      await c.query(
        `UPDATE quadro_ideias SET tarefa_id = $1, atualizado_em = now() WHERE id = $2 AND quadro_id = $3`,
        [body.tarefa_id, ideiaId, id],
      );
    }
  });
  return NextResponse.json({ ok: true });
});

/** DELETE — tira a ideia da lista (guarda arquivada, não some do banco). */
export const DELETE = withAuth<Ctx>(async (user, req, ctx) => {
  const { id, ideiaId } = await ctx.params;
  await withTenant(user.id, (c) =>
    c.query(`UPDATE quadro_ideias SET arquivado_em = now() WHERE id = $1 AND quadro_id = $2`, [ideiaId, id]),
  );
  return new NextResponse(null, { status: 204 });
});

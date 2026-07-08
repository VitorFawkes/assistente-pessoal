import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { anexoDownloadResponse, type AnexoFileRow } from "@/lib/anexo-serve";

type Ctx = { params: Promise<{ id: string; aid: string }> };

/**
 * GET /api/tarefas/[id]/anexos/[aid] — baixa/serve o arquivo do anexo.
 * ?dl=1 força download (attachment) mesmo em formatos que fariam preview inline.
 * RLS escopa ao dono (via tarefas). Links não têm conteúdo → 400.
 */
export const GET = withAuth<Ctx>(async (user, req, ctx) => {
  const { id, aid } = await ctx.params;
  const dl = new URL((req as NextRequest).url).searchParams.get("dl") === "1";

  const row = await withTenant(user.id, async (c) => {
    const r = await c.query<AnexoFileRow & { tipo: string }>(
      `SELECT tipo, filename, content_type, size_bytes, conteudo
         FROM tarefa_anexos WHERE id = $1 AND tarefa_id = $2`,
      [aid, id],
    );
    return r.rows[0] ?? null;
  });

  if (!row) return NextResponse.json({ error: "anexo não encontrado" }, { status: 404 });
  if (row.tipo !== "arquivo" || !row.conteudo) {
    return NextResponse.json({ error: "anexo não é um arquivo" }, { status: 400 });
  }
  return anexoDownloadResponse(row, dl);
});

/**
 * DELETE /api/tarefas/[id]/anexos/[aid] — remove o anexo (link ou arquivo).
 */
export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id, aid } = await ctx.params;
  const n = await withTenant(user.id, async (c) => {
    const r = await c.query(
      "DELETE FROM tarefa_anexos WHERE id = $1 AND tarefa_id = $2 RETURNING id",
      [aid, id],
    );
    return r.rowCount ?? 0;
  });
  if (!n) return NextResponse.json({ error: "anexo não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
});

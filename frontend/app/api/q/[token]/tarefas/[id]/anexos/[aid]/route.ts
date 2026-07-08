import { type NextRequest, NextResponse } from "next/server";
import { withGuest, membershipDoQuadro, guestErrorResponse } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";
import { anexoDownloadResponse, type AnexoFileRow } from "@/lib/anexo-serve";

type Ctx = { params: Promise<{ token: string; id: string; aid: string }> };

/**
 * GET /api/q/[token]/tarefas/[id]/anexos/[aid] — convidado baixa o arquivo.
 * Valida membership; links não têm conteúdo → 400. ?dl=1 força attachment.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { token, id, aid } = await ctx.params;
  const ip = clientIp(req.headers);
  const dl = new URL(req.url).searchParams.get("dl") === "1";

  try {
    const row = await withGuest(token, ip, async ({ acesso, c }) => {
      const isMember = await membershipDoQuadro(c, acesso.quadroId, id);
      if (!isMember) throw new Error("tarefa_not_in_board");
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "tarefa_not_in_board") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return guestErrorResponse(e);
  }
}

/**
 * DELETE /api/q/[token]/tarefas/[id]/anexos/[aid] — convidado remove o anexo.
 * (Diferente da tarefa, que o convidado só desvincula: o anexo é removido de
 * fato — paridade colaborativa no quadro compartilhado.)
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { token, id, aid } = await ctx.params;
  const ip = clientIp(req.headers);

  try {
    const n = await withGuest(token, ip, async ({ acesso, c }) => {
      const isMember = await membershipDoQuadro(c, acesso.quadroId, id);
      if (!isMember) throw new Error("tarefa_not_in_board");
      const r = await c.query(
        "DELETE FROM tarefa_anexos WHERE id = $1 AND tarefa_id = $2 RETURNING id",
        [aid, id],
      );
      return r.rowCount ?? 0;
    });
    if (!n) return NextResponse.json({ error: "anexo não encontrado" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "tarefa_not_in_board") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return guestErrorResponse(e);
  }
}

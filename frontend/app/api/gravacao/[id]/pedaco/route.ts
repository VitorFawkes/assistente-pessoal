import { withAuth } from "@/lib/auth";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@/lib/db";
import { idDeGravacaoValido, nomeDoPedaco, pastaDaGravacao } from "@/lib/gravacao-final";

type Ctx = { params: Promise<{ id: string }> };

const erro = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const n = Number(url.searchParams.get("chunk"));
  const parte = Number(url.searchParams.get("parte") ?? "0");
  if (!idDeGravacaoValido(id) || !Number.isInteger(n) || n < 0 || n > 9999 || !Number.isInteger(parte) || parte < 0 || parte > 1e15) {
    return erro(400, "pedido inválido");
  }

  const existente = await query<{ user_id: string; finalizada_em: string | null }>(
    `SELECT user_id, finalizada_em FROM gravacao_sessoes WHERE id = $1`,
    [id],
  );
  if (existente.length && existente[0].user_id !== user.id) return erro(403, "gravação de outra pessoa");
  if (existente.length && existente[0].finalizada_em) return erro(409, "gravação já encerrada");

  // O enviador manda no máximo 8 MB por vez; folga pro envelope do formulário.
  if (Number(req.headers.get("content-length") || 0) > 12 * 1024 * 1024) return erro(413, "pedaço grande demais");
  const audio = (await req.formData()).get("audio");
  if (!(audio instanceof Blob)) return erro(400, "sem áudio");
  if (audio.size > 12 * 1024 * 1024) return erro(413, "pedaço grande demais");

  try {
    const pasta = await pastaDaGravacao(user.id, id);
    await writeFile(join(pasta, nomeDoPedaco(parte, n)), new Uint8Array(await audio.arrayBuffer()));
    await query(
      `INSERT INTO gravacao_sessoes (id, user_id, chunks_count, last_chunk_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (id) DO UPDATE
       SET chunks_count = gravacao_sessoes.chunks_count + 1, last_chunk_at = now()
       WHERE gravacao_sessoes.user_id = EXCLUDED.user_id`,
      [id, user.id],
    );
    return Response.json({ ok: true, chunk: n });
  } catch (err) {
    console.error("gravacao/pedaco:", err);
    return erro(500, "não consegui salvar o áudio");
  }
});

import { withAuth } from "@/lib/auth";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@/lib/db";

const AUDIO_TMP_DIR = "/audios/tmp";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id: sessionId } = await ctx.params;

  const url = new URL(req.url);
  const chunkIndexStr = url.searchParams.get("chunk") || "0";

  // Validar e sanitizar chunkIndex
  const chunkIndex = parseInt(chunkIndexStr, 10);
  if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex > 9999) {
    return new Response(JSON.stringify({ error: "Índice de chunk inválido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const formData = await req.formData();
  const audioBlob = formData.get("audio");

  if (!(audioBlob instanceof Blob)) {
    return new Response(JSON.stringify({ error: "Nenhum áudio enviado" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const userDir = join(AUDIO_TMP_DIR, user.id, sessionId);
    await mkdir(userDir, { recursive: true });

    const chunkPath = join(userDir, `${chunkIndex}.webm`);
    const buffer = await audioBlob.arrayBuffer();
    await writeFile(chunkPath, new Uint8Array(buffer));

    // Update recording session in database
    await query(
      `INSERT INTO gravacao_sessoes (id, user_id, chunks_count, last_chunk_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (id) DO UPDATE
       SET chunks_count = gravacao_sessoes.chunks_count + 1,
           last_chunk_at = now()`,
      [sessionId, user.id]
    );

    return new Response(JSON.stringify({ ok: true, chunk: chunkIndex }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Chunk upload error:", error);
    return new Response(JSON.stringify({ error: "Erro ao salvar chunk" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

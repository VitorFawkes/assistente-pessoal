import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { withAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";

const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

// Mesma validação do GET /api/audio: só apaga dentro de /audios, sem path traversal.
function resolveAudioFile(storedPath: string): string | null {
  if (!storedPath.startsWith("/audios/") || storedPath.includes("..")) return null;
  const relative = storedPath.replace(/^\/audios\//, "");
  const filePath = resolve(AUDIO_ROOT, relative);
  const rootResolved = resolve(AUDIO_ROOT);
  if (filePath !== rootResolved && !filePath.startsWith(rootResolved + sep)) return null;
  return filePath;
}

export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id deve ser UUID" }, { status: 400 });
  }

  try {
    const { deleted, audioPaths } = await meetingsFor(user.id).deleteCascade(id);
    if (deleted === 0) {
      return NextResponse.json({ error: "reunião não encontrada" }, { status: 404 });
    }

    // Best-effort: apaga os áudios do volume. Falha aqui não desfaz o delete no DB.
    for (const stored of audioPaths) {
      const filePath = resolveAudioFile(stored);
      if (!filePath) continue;
      try {
        await unlink(filePath);
      } catch {
        // arquivo já não existe / sem permissão — ignora
      }
    }

    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

/** PATCH — por enquanto só o nome que uma pessoa dá à reunião.
 *  Sem nome próprio, a tela precisa esculpir um rótulo do parágrafo de resumo,
 *  e em 33 das 177 reuniões esse rótulo ainda começa pelas pessoas em vez do
 *  assunto. Batizar resolve de vez, uma reunião por vez. */
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  let body: { nome?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (body.nome === undefined) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
  }
  const nome = typeof body.nome === "string" ? body.nome.trim().slice(0, 120) : "";
  const ok = await meetingsFor(user.id).renomear(id, nome || null);
  if (!ok) return NextResponse.json({ error: "reunião não encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true, nome: nome || null });
});

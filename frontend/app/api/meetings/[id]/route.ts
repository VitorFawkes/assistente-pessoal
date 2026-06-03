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

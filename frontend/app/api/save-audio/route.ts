// /api/save-audio
// Endpoint público (no PUBLIC_PREFIXES do proxy.ts) — chamado pelo n8n durante
// o ingest. NÃO usa requireUser; valida via X-User-Id que deve vir do header
// (n8n propaga vindo do webhook do mac-agent/PWA). Multi-tenant safe porque o
// arquivo é nomeado por meeting_id (UUID) e o INSERT na meeting já vai com
// user_id correto pelo workflow n8n.
//
// Esse endpoint SÓ escreve no disco; o INSERT em meetings é feito pelo workflow
// n8n (que usa role app_writer com BYPASSRLS e propaga user_id explícito).
import { type NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";

const ALLOWED_EXT = new Set(["mp3", "m4a", "wav", "aac", "flac", "ogg", "mp4"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // X-User-Id é obrigatório pra rastrear ownership. n8n propaga.
  // Durante o rollout, o n8n usa VITOR_FALLBACK_UUID se header ausente.
  const userId = req.headers.get("x-user-id") || "";
  if (!UUID_RE.test(userId)) {
    return NextResponse.json(
      { error: "X-User-Id header obrigatório (UUID)" },
      { status: 400 },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const meetingId = String(form.get("meeting_id") || "").trim();
  const ext = String(form.get("ext") || "mp3").trim().toLowerCase();
  const file = form.get("audio");

  if (!UUID_RE.test(meetingId)) {
    return NextResponse.json({ error: "meeting_id deve ser UUID" }, { status: 400 });
  }
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: "extensao nao permitida", ext }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "campo audio ausente ou invalido" }, { status: 400 });
  }

  const targetPath = resolve(AUDIO_ROOT, `${meetingId}.${ext}`);
  const rootResolved = resolve(AUDIO_ROOT);
  if (!targetPath.startsWith(rootResolved + "/") && targetPath !== rootResolved) {
    return NextResponse.json({ error: "path fora do root" }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(targetPath, bytes);
    return NextResponse.json({
      ok: true,
      audio_path: `/audios/${meetingId}.${ext}`,
      bytes: bytes.length,
      user_id: userId,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "falha ao escrever arquivo",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

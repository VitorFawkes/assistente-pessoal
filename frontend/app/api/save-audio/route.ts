import { type NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";

const ALLOWED_EXT = new Set(["mp3", "m4a", "wav", "aac", "flac", "ogg", "mp4"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
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

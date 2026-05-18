import { type NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { resolve, sep } from "node:path";
import { query } from "@/lib/db";

const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";

function contentTypeFor(path: string): string {
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".m4a")) return "audio/mp4";
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".ogg")) return "audio/ogg";
  if (path.endsWith(".aac")) return "audio/aac";
  if (path.endsWith(".flac")) return "audio/flac";
  return "application/octet-stream";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  try {
    const { meetingId } = await params;

    const rows = await query<{ audio_path: string | null }>(
      "SELECT audio_path FROM meetings WHERE id = $1",
      [meetingId],
    );
    if (!rows.length) {
      return NextResponse.json({ error: "meeting nao encontrada" }, { status: 404 });
    }

    const storedPath = rows[0].audio_path;
    if (!storedPath) {
      return NextResponse.json({ error: "meeting sem audio_path" }, { status: 404 });
    }
    if (!storedPath.startsWith("/audios/") || storedPath.includes("..")) {
      return NextResponse.json(
        { error: "path invalido", path: storedPath },
        { status: 400 },
      );
    }

    const relative = storedPath.replace(/^\/audios\//, "");
    const filePath = resolve(AUDIO_ROOT, relative);

    const rootResolved = resolve(AUDIO_ROOT);
    if (!filePath.startsWith(rootResolved + sep) && filePath !== rootResolved) {
      return NextResponse.json(
        { error: "path fora do root", filePath, rootResolved },
        { status: 400 },
      );
    }

    let stat;
    try {
      stat = statSync(filePath);
    } catch (fsErr) {
      return NextResponse.json(
        {
          error: "arquivo nao encontrado no volume",
          stored: storedPath,
          filePath,
          audioRoot: AUDIO_ROOT,
          fsError: fsErr instanceof Error ? fsErr.message : String(fsErr),
        },
        { status: 404 },
      );
    }

    const fileSize = stat.size;
    const range = req.headers.get("range");
    const ct = contentTypeFor(filePath);

    if (range) {
      const m = /bytes=(\d+)-(\d+)?/.exec(range);
      if (!m) return NextResponse.json({ error: "range invalido" }, { status: 416 });
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
      if (start >= fileSize || end >= fileSize) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }
      const stream = createReadStream(filePath, { start, end });
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": ct,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    const stream = createReadStream(filePath);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "erro inesperado",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
      },
      { status: 500 },
    );
  }
}

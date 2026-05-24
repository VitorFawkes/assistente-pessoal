import { type NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync, openSync, readSync, closeSync } from "node:fs";
import { Readable } from "node:stream";
import { resolve, sep } from "node:path";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sniff dos primeiros bytes pra detectar o container real (extensão pode mentir —
// nosso pipeline antigo salvava mp3 com nome .m4a, fazendo o player rejeitar).
// Lê 12 bytes que cobrem todos os magic numbers comuns.
function detectMagicContentType(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(12);
    readSync(fd, buf, 0, 12, 0);
    // MP3: ID3v2 header "ID3" OR frame sync 0xFFE/0xFFF
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "audio/mpeg";
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";
    // M4A/MP4: bytes 4..7 são "ftyp"
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return "audio/mp4";
    // WAV: "RIFF" .. "WAVE"
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "audio/wav";
    // OGG: "OggS"
    if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return "audio/ogg";
    // FLAC: "fLaC"
    if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return "audio/flac";
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch {}
  }
}

function contentTypeFor(path: string): string {
  // Magic-byte sniff primeiro (extensão pode estar errada em meetings antigas)
  const magic = detectMagicContentType(path);
  if (magic) return magic;
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".m4a")) return "audio/mp4";
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".ogg")) return "audio/ogg";
  if (path.endsWith(".aac")) return "audio/aac";
  if (path.endsWith(".flac")) return "audio/flac";
  return "application/octet-stream";
}

type Ctx = { params: Promise<{ meetingId: string }> };

// Handler interno parametrizado por user_id (resolvido por session OU service token).
async function serveAudio(userId: string, meetingId: string, req: NextRequest) {
  try {
    // RLS garante que o user só acessa meetings próprios. Se não for dele, retorna 404.
    const rows = await withTenant(userId, async (db) => {
      const r = await db.query<{ audio_path: string | null }>(
        "SELECT audio_path FROM meetings WHERE id = $1",
        [meetingId],
      );
      return r.rows;
    });
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

// Wrapper com auth normal (browser do user)
const authedGet = withAuth<Ctx>(async (user, req, ctx) => {
  const { meetingId } = await ctx.params;
  return serveAudio(user.id, meetingId, req as NextRequest);
});

// Dispatcher: rota aceita 2 fluxos
//  1. Service-to-service: X-Webhook-Token + X-User-Id headers (usado por voice-svc).
//     Necessário porque voice-svc não tem cookie de sessão e o volume /audios
//     no easypanel não é compartilhado entre services.
//  2. Auth normal via cookie de sessão (player do user no browser).
export async function GET(req: NextRequest, ctx: Ctx) {
  const token = req.headers.get("x-webhook-token") || "";
  const userIdHeader = req.headers.get("x-user-id") || "";
  if (
    WEBHOOK_TOKEN &&
    token &&
    token === WEBHOOK_TOKEN &&
    UUID_RE.test(userIdHeader)
  ) {
    const { meetingId } = await ctx.params;
    return serveAudio(userIdHeader, meetingId, req);
  }
  return authedGet(req, ctx);
}

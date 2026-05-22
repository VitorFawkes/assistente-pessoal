import { type NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve as resolvePath, join } from "node:path";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // segundos — operação pode levar minutos

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const REPROCESS_WEBHOOK =
  process.env.N8N_REPROCESS_MEETING_URL ||
  "https://n8n.vitorgambetti.com.br/webhook/acoes-reprocess-meeting";

const MODEL = "gpt-4o-transcribe-diarize";
const CHUNK_SECONDS = 1200;
const MAX_DURATION_SINGLE = 1300;
const PARALLEL = 4;

type Segment = { speaker: string; start: number; end: number; text: string };

function physicalPath(audioPath: string): string {
  if (!audioPath.startsWith("/audios/") || audioPath.includes("..")) {
    throw new Error(`audio_path inválido: ${audioPath}`);
  }
  return resolvePath(AUDIO_ROOT, audioPath.replace(/^\/audios\//, ""));
}

async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", rej);
    proc.on("close", (code) => {
      if (code === 0) res();
      else rej(new Error(`ffmpeg ${code}: ${stderr.slice(-200)}`));
    });
  });
}

async function splitToChunks(inputPath: string, outDir: string): Promise<string[]> {
  // ffmpeg segmenter: produz chunk_000.mp3, chunk_001.mp3...
  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-f", "segment",
    "-segment_time", String(CHUNK_SECONDS),
    "-c:a", "libmp3lame",
    "-b:a", "48k",
    "-ac", "1",
    "-ar", "16000",
    join(outDir, "chunk_%03d.mp3"),
  ]);
  // lista os arquivos gerados ordenados
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(outDir))
    .filter((f) => /^chunk_\d{3}\.mp3$/.test(f))
    .sort()
    .map((f) => join(outDir, f));
  if (files.length === 0) throw new Error("ffmpeg não gerou chunks");
  return files;
}

type TranscribeResult = { text: string; segments: Segment[] };

async function transcribeOne(filePath: string): Promise<TranscribeResult> {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("model", MODEL);
  form.append("language", "pt");
  form.append("response_format", "diarized_json");
  form.append("chunking_strategy", "auto");
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }),
    filePath.split("/").pop() || "audio.mp3",
  );
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(300_000),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI ${r.status}: ${t.slice(0, 400)}`);
  }
  const json = (await r.json()) as { text?: string; segments?: Segment[] };
  return {
    text: json.text || "",
    segments: Array.isArray(json.segments)
      ? json.segments.map((s) => ({
        speaker: s.speaker,
        start: s.start,
        end: s.end,
        text: s.text,
      }))
      : [],
  };
}

async function transcribeWithChunking(audioFile: string, duration: number): Promise<TranscribeResult> {
  const size = (await stat(audioFile)).size;
  const needChunks = duration > MAX_DURATION_SINGLE || size > 24 * 1024 * 1024;
  if (!needChunks) {
    return transcribeOne(audioFile);
  }
  const tmp = await mkdtemp(`${tmpdir()}/reprocess-`);
  try {
    const chunks = await splitToChunks(audioFile, tmp);
    // paraleliza com cap
    const results: TranscribeResult[] = new Array(chunks.length);
    let nextIdx = 0;
    async function worker() {
      while (true) {
        const i = nextIdx++;
        if (i >= chunks.length) return;
        results[i] = await transcribeOne(chunks[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
    // concatena com offset
    let fullText = "";
    const fullSegments: Segment[] = [];
    for (let i = 0; i < results.length; i++) {
      const off = i * CHUNK_SECONDS;
      fullText += (fullText ? " " : "") + results[i].text;
      for (const s of results[i].segments) {
        fullSegments.push({
          speaker: s.speaker,
          start: s.start + off,
          end: s.end + off,
          text: s.text,
        });
      }
    }
    return { text: fullText, segments: fullSegments };
  } finally {
    rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const authHeader = req.headers.get("x-admin-token") || "";
  if (!WEBHOOK_TOKEN || authHeader !== WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });
  }

  type Row = {
    id: string;
    audio_path: string;
    duration_seconds: number | null;
    meeting_type: string | null;
    source: string;
    recorded_at: string | null;
  };
  const rows = await query<Row>(
    `SELECT id, audio_path, duration_seconds, meeting_type, source,
            to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at
       FROM meetings WHERE id = $1::uuid`,
    [id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "meeting não encontrada" }, { status: 404 });
  }
  const m = rows[0];
  const phys = physicalPath(m.audio_path);
  try {
    await stat(phys);
  } catch {
    return NextResponse.json({ error: `áudio não existe em ${phys}` }, { status: 404 });
  }
  const duration = m.duration_seconds || 0;

  const t0 = Date.now();
  let result: TranscribeResult;
  try {
    result = await transcribeWithChunking(phys, duration);
  } catch (e) {
    return NextResponse.json(
      { error: "transcribe falhou", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
  const elapsedMs = Date.now() - t0;

  // Dispara webhook do n8n com a nova transcrição
  let webhookStatus = 0;
  let webhookBody = "";
  try {
    const wr = await fetch(REPROCESS_WEBHOOK, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth": WEBHOOK_TOKEN,
      },
      body: JSON.stringify({
        meeting_id: m.id,
        text: result.text,
        segments: result.segments,
        recorded_at: m.recorded_at,
        source: m.source,
        meeting_type: m.meeting_type || "desconhecido",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    webhookStatus = wr.status;
    webhookBody = (await wr.text()).slice(0, 300);
  } catch (e) {
    webhookBody = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    ok: true,
    meeting_id: m.id,
    transcribe_ms: elapsedMs,
    text_length: result.text.length,
    segments_count: result.segments.length,
    distinct_speakers: Array.from(new Set(result.segments.map((s) => s.speaker))).sort(),
    webhook_status: webhookStatus,
    webhook_body: webhookBody,
  });
}

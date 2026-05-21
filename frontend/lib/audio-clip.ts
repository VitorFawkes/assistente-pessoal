import "server-only";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type ClipInterval = {
  start: number;
  end: number;
  outputPath: string;
};

class FfmpegError extends Error {
  constructor(message: string, public stderr: string, public code: number | null) {
    super(message);
    this.name = "FfmpegError";
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const tail = stderr.slice(-800);
        console.error(`[ffmpeg] code=${code} args=${JSON.stringify(args)}\nstderr (last 800):\n${tail}`);
        reject(new FfmpegError(`ffmpeg exited with ${code}: ${tail.slice(-200)}`, stderr, code));
      }
    });
  });
}

export async function clipAudio(
  inputPath: string,
  intervals: ClipInterval[],
): Promise<void> {
  for (const iv of intervals) {
    if (iv.end <= iv.start) {
      throw new Error(`interval inválido: ${iv.start} >= ${iv.end}`);
    }
    await mkdir(dirname(iv.outputPath), { recursive: true });
    const dur = iv.end - iv.start;
    // Decodifica + reencoda pra mp3 64kbps mono 16kHz. Mais lento que -c copy
    // mas roda em qualquer input (m4a iPhone, mp3 etc) e produz output uniforme.
    // -ss DEPOIS do -i pra evitar problema de seek em m4a com MOOV no final.
    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-ss", iv.start.toFixed(3),
      "-t", dur.toFixed(3),
      "-vn",
      "-c:a", "libmp3lame",
      "-b:a", "64k",
      "-ac", "1",
      "-ar", "16000",
      "-loglevel", "warning",
      iv.outputPath,
    ]);
  }
}

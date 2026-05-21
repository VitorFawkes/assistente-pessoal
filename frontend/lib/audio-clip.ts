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
      else reject(new FfmpegError(`ffmpeg exited with ${code}`, stderr, code));
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
    await runFfmpeg([
      "-y",
      "-ss", iv.start.toFixed(3),
      "-t", dur.toFixed(3),
      "-i", inputPath,
      "-c", "copy",
      "-loglevel", "warning",
      iv.outputPath,
    ]);
  }
}

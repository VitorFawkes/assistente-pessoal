import { withAuth } from "@/lib/auth";
import { spawn } from "node:child_process";
import { readdir, readFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@/lib/db";

const AUDIO_TMP_DIR = "/audios/tmp";
const AUDIO_FINAL_DIR = "/audios";

function runFfmpeg(args: string[]): Promise<void> {
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
        const tail = stderr.slice(-500);
        console.error(`[ffmpeg] code=${code}\nstderr:\n${tail}`);
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (user, req, ctx) => {
  const { id: sessionId } = await ctx.params;

  try {
    const userTmpDir = join(AUDIO_TMP_DIR, user.id, sessionId);

    // Read all chunks
    const chunks = await readdir(userTmpDir);
    const sortedChunks = chunks
      .filter((f) => f.endsWith(".webm"))
      .sort((a, b) => {
        const numA = parseInt(a.split(".")[0]);
        const numB = parseInt(b.split(".")[0]);
        return numA - numB;
      });

    if (sortedChunks.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum chunk encontrado" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create concat file for ffmpeg
    const concatFile = join(userTmpDir, "concat.txt");
    const concatContent = sortedChunks
      .map((chunk) => `file '${join(userTmpDir, chunk)}'`)
      .join("\n");

    await writeFile(concatFile, concatContent);

    // Join chunks with ffmpeg
    const now = new Date();
    const dateDir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(
      2,
      "0"
    )}`;
    const outputDir = join(AUDIO_FINAL_DIR, dateDir);
    await mkdir(outputDir, { recursive: true });

    const outputPath = join(outputDir, `${sessionId}.mp3`);

    await runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-y",
      outputPath,
    ]);

    // Upload to ingest-svc
    const audioData = await readFile(outputPath);
    const ingestUrl = process.env.INGEST_INTERNAL_URL || "http://ingest-svc:8000";
    const webhookToken = process.env.WEBHOOK_TOKEN || "";

    const formData = new FormData();
    formData.append("file", new Blob([audioData], { type: "audio/mpeg" }), "audio.mp3");

    const ingestResponse = await fetch(`${ingestUrl}/upload`, {
      method: "POST",
      headers: {
        "X-Auth": webhookToken,
        "X-User-Id": user.id,
      },
      body: formData,
    });

    if (!ingestResponse.ok) {
      console.error("Ingest upload failed:", await ingestResponse.text());
      throw new Error(`Ingest upload failed with ${ingestResponse.status}`);
    }

    // Mark session as finalized
    await query(
      `UPDATE gravacao_sessoes SET finalizada_em = now() WHERE id = $1 AND user_id = $2`,
      [sessionId, user.id]
    );

    // Cleanup temp files (async, don't wait)
    cleanup(userTmpDir).catch((err) => console.error("Cleanup error:", err));

    return new Response(JSON.stringify({ ok: true, meeting_id: sessionId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Recording finalization error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Erro ao finalizar gravação",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});

async function cleanup(dir: string) {
  try {
    const files = await readdir(dir);
    for (const file of files) {
      await unlink(join(dir, file));
    }
  } catch (err) {
    console.error("Failed to cleanup temp files:", err);
  }
}

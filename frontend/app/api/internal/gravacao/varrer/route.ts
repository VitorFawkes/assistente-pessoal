import { query } from "@/lib/db";
import { readdir, readFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const AUDIO_TMP_DIR = "/audios/tmp";
const AUDIO_FINAL_DIR = "/audios";
const TIMEOUT_MINUTES = 10;

function verifyToken(req: Request): boolean {
  const token = req.headers.get("x-webhook-token") || req.headers.get("x-auth") || "";
  const expected = process.env.WEBHOOK_TOKEN || "";
  return token === expected && expected.length > 0;
}

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


export const POST = async (req: Request) => {
  if (!verifyToken(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Find sessions that timed out (use placeholder instead of string interpolation)
    const timedOutSessions = await query(
      `SELECT id, user_id, chunks_count
       FROM gravacao_sessoes
       WHERE finalizada_em IS NULL
       AND last_chunk_at < now() - make_interval(mins := $1)`,
      [TIMEOUT_MINUTES]
    ) as Array<{ id: string; user_id: string; chunks_count: number }>;

    let processed = 0;
    let failed = 0;

    for (const session of timedOutSessions) {
      try {
        await finalizeRecording(session.id, session.user_id);
        processed++;
      } catch (err) {
        console.error(`Failed to finalize session ${session.id}:`, err);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed,
        failed,
        total: timedOutSessions.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Cleanup sweep error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Erro ao varrer",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

async function finalizeRecording(sessionId: string, userId: string) {
  const userTmpDir = join(AUDIO_TMP_DIR, userId, sessionId);

  try {
    // Read all chunks
    const chunks = await readdir(userTmpDir).catch(() => []);
    const sortedChunks = chunks
      .filter((f) => /^\d+\.webm$/.test(f))  // Validar que nome é só números + .webm
      .sort((a, b) => {
        const numA = parseInt(a.split(".")[0]);
        const numB = parseInt(b.split(".")[0]);
        return numA - numB;
      });

    if (sortedChunks.length === 0) {
      // No chunks, just mark as finalized
      await query(
        `UPDATE gravacao_sessoes SET finalizada_em = now() WHERE id = $1 AND user_id = $2`,
        [sessionId, userId]
      );
      return;
    }

    // Create concat file for ffmpeg
    const concatFile = join(userTmpDir, "concat.txt");
    const concatContent = sortedChunks
      .map((chunk) => `file '${join(userTmpDir, chunk).replace(/'/g, "'\\''")}'`)
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
        "X-User-Id": userId,
      },
      body: formData,
    });

    if (!ingestResponse.ok) {
      console.error(
        `Ingest upload failed for ${sessionId}:`,
        await ingestResponse.text()
      );
      throw new Error(`Ingest upload failed with ${ingestResponse.status}`);
    }

    // Mark session as finalized
    await query(
      `UPDATE gravacao_sessoes SET finalizada_em = now() WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );

    // Cleanup temp files
    await cleanup(userTmpDir).catch((err) =>
      console.error("Cleanup error:", err)
    );
  } catch (err) {
    console.error(`Error finalizing recording ${sessionId}:`, err);
    // Mark as finalized even if upload failed
    await query(
      `UPDATE gravacao_sessoes SET finalizada_em = now() WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    ).catch(() => {});
    throw err;
  }
}

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

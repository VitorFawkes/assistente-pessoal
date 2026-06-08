import { type NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";

// Reprocessa o áudio de uma meeting: RE-TRANSCREVE (com diarização) e dispara o
// webhook n8n que restaura segments + re-extrai tarefas com texto rotulado.
//
// NÃO-BLOQUEANTE: responde 202 na hora e faz o trabalho pesado em background.
// Transcrição longa síncrona estourava o timeout do gateway (502) e o handler era
// abortado ao cliente desconectar. Transcrição via AssemblyAA (assíncrono, aguenta
// áudio de horas em uma chamada) em vez de gpt-4o-transcribe-diarize em chunks.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const VOICE_SVC_URL = process.env.VOICE_SVC_URL || "http://voice-svc:8000";
const REPROCESS_WEBHOOK =
  process.env.N8N_REPROCESS_MEETING_URL ||
  "https://n8n.vitorgambetti.com.br/webhook/acoes-reprocess-meeting";
const AAI = "https://api.assemblyai.com";

type Segment = { speaker: string; start: number; end: number; text: string };

function physicalPath(audioPath: string): string {
  if (!audioPath.startsWith("/audios/") || audioPath.includes("..")) {
    throw new Error(`audio_path inválido: ${audioPath}`);
  }
  return resolvePath(AUDIO_ROOT, audioPath.replace(/^\/audios\//, ""));
}

type Utterance = { speaker?: string; start?: number; end?: number; text?: string };

async function transcribeAssemblyAI(
  filePath: string,
): Promise<{ text: string; segments: Segment[] }> {
  const aaiHeaders = { Authorization: ASSEMBLYAI_API_KEY };
  // 1) upload
  const bytes = await readFile(filePath);
  const up = await fetch(`${AAI}/v2/upload`, {
    method: "POST",
    headers: aaiHeaders,
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(300_000),
  });
  if (!up.ok) throw new Error(`AAI upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const { upload_url } = (await up.json()) as { upload_url: string };

  // 2) solicita transcrição com diarização
  const tr = await fetch(`${AAI}/v2/transcript`, {
    method: "POST",
    headers: { ...aaiHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: "pt",
      speaker_labels: true,
      speech_models: ["universal-3-pro", "universal-2"],
    }),
  });
  if (!tr.ok) throw new Error(`AAI transcript ${tr.status}: ${(await tr.text()).slice(0, 200)}`);
  const { id } = (await tr.json()) as { id: string };

  // 3) poll (até ~30min)
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const s = await fetch(`${AAI}/v2/transcript/${id}`, { headers: aaiHeaders });
    const j = (await s.json()) as {
      status: string;
      text?: string;
      error?: string;
      utterances?: Utterance[];
    };
    if (j.status === "completed") {
      const segments: Segment[] = (j.utterances || [])
        .filter((u) => /^[A-Z]+$/.test(u.speaker || ""))
        .map((u) => ({
          speaker: u.speaker as string,
          start: (u.start || 0) / 1000,
          end: (u.end || 0) / 1000,
          text: u.text || "",
        }));
      return { text: j.text || "", segments };
    }
    if (j.status === "error") throw new Error(`AAI error: ${j.error}`);
  }
  throw new Error("AAI poll timeout");
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
  if (!ASSEMBLYAI_API_KEY) {
    return NextResponse.json({ error: "ASSEMBLYAI_API_KEY missing" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}) as { user_id?: string });
  const userId = typeof body?.user_id === "string" ? body.user_id : null;
  if (!userId || !UUID_RE.test(userId)) {
    return NextResponse.json(
      { error: "user_id (UUID) obrigatório no body — meeting é escopada por user" },
      { status: 400 },
    );
  }

  type Row = {
    id: string;
    audio_path: string;
    meeting_type: string | null;
    source: string;
    recorded_at: string | null;
  };
  const rows = await withTenant(userId, async (db) => {
    const r = await db.query<Row>(
      `SELECT id, audio_path, meeting_type, source,
              to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at
         FROM meetings WHERE id = $1::uuid`,
      [id],
    );
    return r.rows;
  });
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "meeting não encontrada (ou não pertence a esse user)" },
      { status: 404 },
    );
  }
  const m = rows[0];
  let phys: string;
  try {
    phys = physicalPath(m.audio_path);
    await stat(phys);
  } catch {
    return NextResponse.json({ error: `áudio inacessível: ${m.audio_path}` }, { status: 404 });
  }

  // marca analyzing já (UI mostra "processando")
  await withTenant(userId, (db) =>
    db.query("UPDATE meetings SET status = 'analyzing', status_error = NULL WHERE id = $1::uuid", [id]),
  );

  // trabalho pesado em background — não bloqueia a resposta
  void (async () => {
    try {
      const { text, segments } = await transcribeAssemblyAI(phys);
      await fetch(REPROCESS_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth": WEBHOOK_TOKEN },
        body: JSON.stringify({
          meeting_id: id,
          user_id: userId,
          text,
          segments,
          recorded_at: m.recorded_at,
          source: m.source,
          meeting_type: m.meeting_type || "desconhecido",
        }),
        signal: AbortSignal.timeout(180_000),
      });
      // sugere nomes dos speakers (best-effort; segments já foram gravados pelo reset)
      await fetch(`${VOICE_SVC_URL}/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_id: id, user_id: userId }),
        signal: AbortSignal.timeout(120_000),
      }).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await withTenant(userId, (db) =>
        db.query("UPDATE meetings SET status = 'error', status_error = $2 WHERE id = $1::uuid", [id, msg.slice(0, 500)]),
      ).catch(() => {});
    }
  })();

  return NextResponse.json({ status: "processing", meeting_id: id }, { status: 202 });
}

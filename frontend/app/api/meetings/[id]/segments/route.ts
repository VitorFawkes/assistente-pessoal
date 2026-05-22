import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath, dirname } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { withClient } from "@/lib/db";
import { clipAudio, type ClipInterval } from "@/lib/audio-clip";
import { sendWhatsApp } from "@/lib/whatsapp";
import { DETECT_CONSTANTS } from "@/lib/detect-cuts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";
const N8N_WEBHOOK = process.env.N8N_PROCESS_SEGMENT_URL
  || "https://n8n.vitorgambetti.com.br/webhook/acoes-process-segment";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

type Segment = { speaker: string; start: number; end: number; text: string };

type ParentRow = {
  id: string;
  status: string;
  parent_meeting_id: string | null;
  audio_path: string;
  duration_seconds: number | null;
  meeting_type: string | null;
  recorded_at: string | null;
  segments: Segment[] | null;
};

type Body = {
  cuts?: Array<{ at_seconds?: number; title?: string | null }>;
  archive_only?: boolean;
  mark_single?: boolean;
  restore?: boolean;
};

type ChildResult = {
  id: string;
  start: number;
  end: number;
  title: string | null;
  audio_path: string;
  physical_temp: string;
  physical_final: string;
};

function physicalPath(audioPath: string): string {
  if (!audioPath.startsWith("/audios/") || audioPath.includes("..")) {
    throw new Error(`audio_path inválido: ${audioPath}`);
  }
  const relative = audioPath.replace(/^\/audios\//, "");
  return resolvePath(AUDIO_ROOT, relative);
}

function childAudioPaths(childIds: string[]): { logical: string[]; physical: string[] } {
  // Output sempre mp3 — clipAudio reencoda pra mp3 64kbps mono 16kHz.
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const logical = childIds.map((id) => `/audios/${year}/${month}/${id}.mp3`);
  const physical = logical.map((p) => physicalPath(p));
  return { logical, physical };
}

function coerceSegments(raw: unknown): Segment[] {
  if (Array.isArray(raw)) return raw as Segment[];
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Segment[];
    } catch {
      // fall through
    }
  }
  return [];
}

function filterSegmentsForInterval(
  segments: Segment[],
  start: number,
  end: number,
): { childSegments: Segment[]; transcription: string } {
  const inRange = segments.filter((s) => {
    const ss = typeof s.start === "number" ? s.start : parseFloat(String(s.start));
    const se = typeof s.end === "number" ? s.end : parseFloat(String(s.end));
    return ss >= start && se <= end;
  });
  const childSegments = inRange.map((s) => {
    const ss = typeof s.start === "number" ? s.start : parseFloat(String(s.start));
    const se = typeof s.end === "number" ? s.end : parseFloat(String(s.end));
    return {
      speaker: s.speaker,
      start: ss - start,
      end: se - start,
      text: s.text,
    };
  });
  const transcription = childSegments.map((s) => s.text).join("");
  return { childSegments, transcription };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const body: Body = (await req.json().catch(() => ({}))) as Body;
  const archiveOnly = body.archive_only === true;
  const markSingle = body.mark_single === true;
  const restore = body.restore === true;
  const rawCuts = Array.isArray(body.cuts) ? body.cuts : [];

  const modeCount = [archiveOnly, markSingle, restore, rawCuts.length > 0]
    .filter(Boolean).length;
  if (modeCount !== 1) {
    return NextResponse.json(
      { error: "MUST_SPECIFY_ONE_MODE" },
      { status: 400 },
    );
  }

  const cuts: Array<{ at_seconds: number; title: string | null }> = [];
  for (const c of rawCuts) {
    if (typeof c?.at_seconds !== "number" || !Number.isFinite(c.at_seconds)) continue;
    const title = typeof c?.title === "string" ? c.title.trim().slice(0, 200) : null;
    cuts.push({ at_seconds: c.at_seconds, title: title || null });
  }
  cuts.sort((a, b) => a.at_seconds - b.at_seconds);

  const movedToFinal: string[] = []; // pra apagar se algo após rename falhar

  try {
    const result = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const r = await c.query<ParentRow>(
          `SELECT id, status, parent_meeting_id, audio_path, duration_seconds,
                  meeting_type, recorded_at::text AS recorded_at, segments
           FROM meetings WHERE id = $1::uuid FOR UPDATE`,
          [id],
        );
        if (!r.rows.length) throw new Error("NOT_FOUND");
        const parent = r.rows[0];
        if (parent.parent_meeting_id) throw new Error("IS_CHILD");

        if (restore) {
          if (parent.status !== "archived_session") throw new Error("NOT_ARCHIVED");
          await c.query(
            `UPDATE meetings SET status='done', needs_segmentation=false
             WHERE id = $1::uuid`,
            [id],
          );
          await c.query("COMMIT");
          return {
            parent,
            children: [] as ChildResult[],
            archived: false,
            restored: true,
            markedSingle: false,
          };
        }

        if (parent.status === "archived_session") throw new Error("ALREADY_ARCHIVED");

        if (markSingle) {
          await c.query(
            `UPDATE meetings SET needs_segmentation=false WHERE id = $1::uuid`,
            [id],
          );
          await c.query("COMMIT");
          return {
            parent,
            children: [] as ChildResult[],
            archived: false,
            restored: false,
            markedSingle: true,
          };
        }

        const duration = parent.duration_seconds || 0;
        if (duration <= 0) throw new Error("PARENT_NO_DURATION");

        if (archiveOnly) {
          await c.query(
            `UPDATE meetings SET status='archived_session', needs_segmentation=false
             WHERE id = $1::uuid`,
            [id],
          );
          await c.query("COMMIT");
          return {
            parent,
            children: [] as ChildResult[],
            archived: true,
            restored: false,
            markedSingle: false,
          };
        }

        for (const cut of cuts) {
          if (cut.at_seconds <= 0 || cut.at_seconds >= duration) {
            throw new Error(`CUT_OUT_OF_RANGE:${cut.at_seconds}`);
          }
        }
        const positions = [0, ...cuts.map((c) => c.at_seconds), duration];
        for (let i = 0; i < positions.length - 1; i++) {
          const segDur = positions[i + 1] - positions[i];
          if (segDur < DETECT_CONSTANTS.MIN_SEGMENT_DURATION) {
            throw new Error(`SEGMENT_TOO_SHORT:${segDur}`);
          }
        }
        const intervals: Array<{ start: number; end: number; title: string | null }> = [];
        for (let i = 0; i < positions.length - 1; i++) {
          intervals.push({
            start: positions[i],
            end: positions[i + 1],
            title: i === 0 ? null : cuts[i - 1].title,
          });
        }

        const childIds = intervals.map(() => randomUUID());
        const { logical: logicalPaths, physical: physicalPaths } = childAudioPaths(childIds);

        const parentPhys = physicalPath(parent.audio_path);
        // ffmpeg escreve direto no destino final — /tmp e /audios estão em
        // mounts diferentes no container easypanel (EXDEV em fs.rename).
        // Pre-cria dirs primeiro. Se ffmpeg falhar, catch externo apaga órfãos via movedToFinal.
        for (let i = 0; i < intervals.length; i++) {
          await mkdir(dirname(physicalPaths[i]), { recursive: true });
        }
        const clipIntervals: ClipInterval[] = intervals.map((iv, i) => ({
          start: iv.start,
          end: iv.end,
          outputPath: physicalPaths[i],
        }));
        // Marca todos como "potencialmente criados" antes do ffmpeg — se ffmpeg
        // falhar no meio, alguns existem. Catch apaga.
        for (const p of physicalPaths) movedToFinal.push(p);
        await clipAudio(parentPhys, clipIntervals);
        // Daqui em diante: DB INSERTs + UPDATE pre-commit. Se DB falhar, ROLLBACK
        // + catch apaga arquivos do /audios via movedToFinal.

        const childResults: ChildResult[] = [];
        const rawSegs = parent.segments;
        const parentSegments = coerceSegments(rawSegs);
        // Debug exposto no response pra diagnosticar (remover depois)
        const debugSegs = {
          raw_type: rawSegs === null ? "null" : Array.isArray(rawSegs) ? "array" : typeof rawSegs,
          raw_length: Array.isArray(rawSegs) ? rawSegs.length : (typeof rawSegs === "string" ? (rawSegs as string).length : null),
          coerced_count: parentSegments.length,
          first_raw: Array.isArray(rawSegs) && rawSegs.length > 0 ? rawSegs[0] : null,
        };
        console.log("[segments]", JSON.stringify(debugSegs));
        for (let i = 0; i < intervals.length; i++) {
          const iv = intervals[i];
          const cid = childIds[i];
          const { childSegments, transcription } = filterSegmentsForInterval(
            parentSegments,
            iv.start,
            iv.end,
          );
          await c.query(
            `INSERT INTO meetings (
               id, source, meeting_type, original_filename, audio_path,
               duration_seconds, recorded_at, status, transcription, segments,
               parent_meeting_id, segment_index, segment_start_offset, segment_end_offset
             ) VALUES (
               $1::uuid, 'segmented', $2, $3, $4,
               $5, $6, 'received', $7, $8::jsonb,
               $9::uuid, $10, $11, $12
             )`,
            [
              cid,
              parent.meeting_type,
              `segment-${i + 1}.mp3`,
              logicalPaths[i],
              Math.round(iv.end - iv.start),
              parent.recorded_at,
              transcription,
              JSON.stringify(childSegments),
              parent.id,
              i,
              iv.start,
              iv.end,
            ],
          );
          childResults.push({
            id: cid,
            start: iv.start,
            end: iv.end,
            title: iv.title,
            audio_path: logicalPaths[i],
            physical_temp: physicalPaths[i],
            physical_final: physicalPaths[i],
          });
        }

        await c.query(
          `UPDATE meetings SET status='archived_session', needs_segmentation=false
           WHERE id = $1::uuid`,
          [id],
        );

        await c.query("COMMIT");

        return {
          parent,
          children: childResults,
          archived: false,
          restored: false,
          markedSingle: false,
          _debug: debugSegs,
        };
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    });

    for (const child of result.children) {
      fetch(N8N_WEBHOOK, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth": WEBHOOK_TOKEN,
        },
        body: JSON.stringify({ meeting_id: child.id }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {
        console.warn(`[segments] webhook n8n falhou pra ${child.id}`);
      });
    }

    if (result.archived) {
      sendWhatsApp(`📦 Sessão arquivada sem segmentação.`).catch(() => {});
    } else if (result.restored) {
      sendWhatsApp(`♻️ Sessão arquivada restaurada.`).catch(() => {});
    } else if (result.children.length > 0) {
      const recordedAt = result.parent.recorded_at;
      const dateStr = recordedAt
        ? new Date(recordedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
        : "hoje";
      sendWhatsApp(
        `✂️ Sessão de ${dateStr} segmentada em ${result.children.length} reuniões. Tarefas serão extraídas em segundo plano.`,
      ).catch(() => {});
    }

    return NextResponse.json({
      parent_id: result.parent.id,
      archived_only: result.archived,
      restored: result.restored,
      marked_single: result.markedSingle,
      segments_created: result.children.map((c) => ({
        id: c.id,
        start: c.start,
        end: c.end,
        title: c.title,
      })),
      _debug: (result as { _debug?: unknown })._debug,
    });
  } catch (e) {
    // Se arquivos já moveram pro destino mas a transação falhou depois → apaga órfãos
    for (const p of movedToFinal) {
      rm(p, { force: true }).catch(() => {});
    }
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      msg === "NOT_FOUND" ? 404 :
      msg === "ALREADY_ARCHIVED" ? 409 :
      msg === "NOT_ARCHIVED" ? 409 :
      msg === "IS_CHILD" ? 409 :
      msg.startsWith("CUT_") || msg.startsWith("SEGMENT_") || msg === "PARENT_NO_DURATION" ? 400 :
      500;
    return NextResponse.json({ error: msg }, { status });
  }
}

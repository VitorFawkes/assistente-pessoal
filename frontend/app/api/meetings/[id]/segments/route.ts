import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
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

function filterSegmentsForInterval(
  segments: Segment[],
  start: number,
  end: number,
): { childSegments: Segment[]; transcription: string } {
  const inRange = segments.filter((s) => s.start >= start && s.end <= end);
  const childSegments = inRange.map((s) => ({
    speaker: s.speaker,
    start: s.start - start,
    end: s.end - start,
    text: s.text,
  }));
  const transcription = childSegments.map((s) => s.text).join("");
  return { childSegments, transcription };
}

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const body: Body = (await (req as NextRequest).json().catch(() => ({}))) as Body;
  const archiveOnly = body.archive_only === true;
  const rawCuts = Array.isArray(body.cuts) ? body.cuts : [];

  const cuts: Array<{ at_seconds: number; title: string | null }> = [];
  for (const c of rawCuts) {
    if (typeof c?.at_seconds !== "number" || !Number.isFinite(c.at_seconds)) continue;
    const title = typeof c?.title === "string" ? c.title.trim().slice(0, 200) : null;
    cuts.push({ at_seconds: c.at_seconds, title: title || null });
  }
  cuts.sort((a, b) => a.at_seconds - b.at_seconds);

  let tempDir: string | null = null;
  let cleanupTemp = true;

  try {
    // withTenant abre transação + SET LOCAL app.current_user_id; RLS filtra
    // meetings/tarefas pelo user automaticamente.
    const result = await withTenant(user.id, async (c) => {
      try {
        const r = await c.query<ParentRow>(
          `SELECT id, status, parent_meeting_id, audio_path, duration_seconds,
                  meeting_type, recorded_at::text AS recorded_at, segments
           FROM meetings WHERE id = $1::uuid FOR UPDATE`,
          [id],
        );
        if (!r.rows.length) throw new Error("NOT_FOUND");
        const parent = r.rows[0];
        if (parent.status === "archived_session") throw new Error("ALREADY_ARCHIVED");
        if (parent.parent_meeting_id) throw new Error("IS_CHILD");
        const duration = parent.duration_seconds || 0;
        if (duration <= 0) throw new Error("PARENT_NO_DURATION");

        if (archiveOnly) {
          await c.query(
            `UPDATE meetings SET status='archived_session', needs_segmentation=false
             WHERE id = $1::uuid`,
            [id],
          );
          return { parent, children: [] as ChildResult[], archived: true };
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
        tempDir = await mkdtemp(`${tmpdir()}/segments-${id}-`);
        const tempPaths = childIds.map((cid) => `${tempDir}/${cid}.mp3`);
        const clipIntervals: ClipInterval[] = intervals.map((iv, i) => ({
          start: iv.start,
          end: iv.end,
          outputPath: tempPaths[i],
        }));
        await clipAudio(parentPhys, clipIntervals);

        const childResults: ChildResult[] = [];
        const parentSegments = parent.segments || [];
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
               id, user_id, source, meeting_type, original_filename, audio_path,
               duration_seconds, recorded_at, status, transcription, segments,
               parent_meeting_id, segment_index, segment_start_offset, segment_end_offset
             ) VALUES (
               $1::uuid, $13::uuid, 'segmented', $2, $3, $4,
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
              user.id,
            ],
          );
          childResults.push({
            id: cid,
            start: iv.start,
            end: iv.end,
            title: iv.title,
            audio_path: logicalPaths[i],
            physical_temp: tempPaths[i],
            physical_final: physicalPaths[i],
          });
        }

        await c.query(
          `UPDATE meetings SET status='archived_session', needs_segmentation=false
           WHERE id = $1::uuid`,
          [id],
        );

        // Move arquivos do tmp pro destino final APÓS withTenant fecha COMMIT
        // (não dá pra fazer dentro de withTenant porque o rename é I/O fora da tx).
        // Solução: marcar pra fazer no caller depois do return.
        return { parent, children: childResults, archived: false };
      } catch (e) {
        throw e;
      }
    });

    // Renomes fora da transação (já COMMITou se chegou aqui).
    if (!result.archived && result.children.length > 0) {
      for (const child of result.children) {
        await rename(child.physical_temp, child.physical_final);
      }
      cleanupTemp = false;
    } else {
      cleanupTemp = false;
    }

    for (const child of result.children) {
      fetch(N8N_WEBHOOK, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth": WEBHOOK_TOKEN,
          "x-user-id": user.id,
        },
        body: JSON.stringify({ meeting_id: child.id, user_id: user.id }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {
        console.warn(`[segments] webhook n8n falhou pra ${child.id}`);
      });
    }

    if (result.archived) {
      sendWhatsApp(`📦 Sessão arquivada sem segmentação.`).catch(() => {});
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
      segments_created: result.children.map((c) => ({
        id: c.id,
        start: c.start,
        end: c.end,
        title: c.title,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      msg === "NOT_FOUND" ? 404 :
      msg === "ALREADY_ARCHIVED" ? 409 :
      msg === "IS_CHILD" ? 409 :
      msg.startsWith("CUT_") || msg.startsWith("SEGMENT_") || msg === "PARENT_NO_DURATION" ? 400 :
      500;
    return NextResponse.json({ error: msg }, { status });
  } finally {
    if (tempDir && cleanupTemp) {
      rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

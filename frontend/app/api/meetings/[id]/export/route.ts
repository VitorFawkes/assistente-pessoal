import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";
import { fmtDate } from "@/lib/utils";
import {
  coerceSegments,
  toPlainText,
  toSrt,
  toVtt,
  toMarkdown,
  filterBySection,
  participantNames,
} from "@/lib/transcript-format";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORMATS = {
  txt: { ext: "txt", mime: "text/plain; charset=utf-8" },
  srt: { ext: "srt", mime: "application/x-subrip; charset=utf-8" },
  vtt: { ext: "vtt", mime: "text/vtt; charset=utf-8" },
  md: { ext: "md", mime: "text/markdown; charset=utf-8" },
} as const;

type Fmt = keyof typeof FORMATS;
type Ctx = { params: Promise<{ id: string }> };

function coerceSections(raw: unknown): { start_seconds: number; title: string }[] {
  if (Array.isArray(raw)) return raw as { start_seconds: number; title: string }[];
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p;
    } catch {
      // ignore
    }
  }
  return [];
}

export const GET = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const url = new URL((req as NextRequest).url);
  const format = (url.searchParams.get("format") || "txt") as Fmt;
  if (!FORMATS[format]) {
    return NextResponse.json({ error: "format inválido" }, { status: 400 });
  }
  const scope = url.searchParams.get("scope") || "full";
  const sectionIdx = Number(url.searchParams.get("section"));

  const m = await meetingsFor(user.id).forExport(id);
  if (!m) return NextResponse.json({ error: "não encontrada" }, { status: 404 });

  const allSegments = coerceSegments(m.segments);
  if (allSegments.length === 0) {
    return NextResponse.json({ error: "sem transcrição" }, { status: 422 });
  }
  const labels = m.speaker_labels || {};
  const sections = coerceSections(m.sections);

  let segments = allSegments;
  let titleSuffix = "";
  if (scope === "section" && Number.isInteger(sectionIdx) && sections[sectionIdx]) {
    segments = filterBySection(allSegments, sections, sectionIdx, m.duration_seconds || 0);
    titleSuffix = ` — ${sections[sectionIdx].title}`;
    if (segments.length === 0) {
      return NextResponse.json({ error: "seção vazia" }, { status: 422 });
    }
  }

  let body: string;
  if (format === "txt") body = toPlainText(segments, labels);
  else if (format === "srt") body = toSrt(segments, labels);
  else if (format === "vtt") body = toVtt(segments, labels);
  else
    body = toMarkdown(segments, labels, {
      title: (m.summary || "Reunião") + titleSuffix,
      dateLabel: m.recorded_at ? fmtDate(m.recorded_at) : "sem data",
      participants: participantNames(segments, labels),
    });

  const datePart = m.recorded_at ? m.recorded_at.slice(0, 10) : "sem-data";
  const filename = `reuniao-${datePart}.${FORMATS[format].ext}`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": FORMATS[format].mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

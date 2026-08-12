import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";
import { fmtDate } from "@/lib/utils";
import { meetingSubject } from "@/lib/meeting-label";
import {
  coerceSegments,
  toPlainText,
  toSrt,
  toVtt,
  toMarkdown,
  turnsToMarkdown,
  filterBySection,
  participantNames,
} from "@/lib/transcript-format";
import { summaryToMarkdown, summaryToPlainText } from "@/lib/summary-format";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORMATS = {
  txt: { ext: "txt", mime: "text/plain; charset=utf-8" },
  srt: { ext: "srt", mime: "application/x-subrip; charset=utf-8" },
  vtt: { ext: "vtt", mime: "text/vtt; charset=utf-8" },
  md: { ext: "md", mime: "text/markdown; charset=utf-8" },
} as const;

// O que vai no arquivo — e o prefixo do nome dele.
const CONTENTS = {
  transcricao: "reuniao",
  resumo: "resumo",
  completo: "reuniao-completa",
} as const;

type Fmt = keyof typeof FORMATS;
type Content = keyof typeof CONTENTS;
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
  const content = (url.searchParams.get("content") || "transcricao") as Content;
  if (!CONTENTS[content]) {
    return NextResponse.json({ error: "content inválido" }, { status: 400 });
  }
  // Legenda só faz sentido colada no áudio — resumo não tem timestamp.
  if (content !== "transcricao" && format !== "txt" && format !== "md") {
    return NextResponse.json(
      { error: "resumo só sai em txt ou md" },
      { status: 400 },
    );
  }
  const scope = url.searchParams.get("scope") || "full";
  const sectionIdx = Number(url.searchParams.get("section"));

  const m = await meetingsFor(user.id).forExport(id);
  if (!m) return NextResponse.json({ error: "não encontrada" }, { status: 404 });

  const allSegments = coerceSegments(m.segments);
  if (content !== "resumo" && allSegments.length === 0) {
    return NextResponse.json({ error: "sem transcrição" }, { status: 422 });
  }
  if (content !== "transcricao" && !m.executive_summary) {
    return NextResponse.json({ error: "sem resumo" }, { status: 422 });
  }
  const labels = m.speaker_labels || {};
  const sections = coerceSections(m.sections);

  let segments = allSegments;
  let titleSuffix = "";
  if (
    content === "transcricao" &&
    scope === "section" &&
    Number.isInteger(sectionIdx) &&
    sections[sectionIdx]
  ) {
    segments = filterBySection(allSegments, sections, sectionIdx, m.duration_seconds || 0);
    titleSuffix = ` — ${sections[sectionIdx].title}`;
    if (segments.length === 0) {
      return NextResponse.json({ error: "seção vazia" }, { status: 422 });
    }
  }

  const dateLabel = m.recorded_at ? fmtDate(m.recorded_at) : "sem data";
  // Na tela o título é o assunto e o parágrafo da IA vem logo abaixo — o
  // arquivo repete essa ordem pra abrir igual ao que ele viu.
  const subject = meetingSubject(m.summary) || "Reunião";
  const intro = m.summary ? `${m.summary}\n\n` : "";
  const exec = m.executive_summary || "";

  const resumoTxt = () =>
    `${subject}\n${dateLabel}\n\n${intro}${summaryToPlainText(exec)}`;
  const resumoMd = () =>
    `# ${subject}\n\n**Data:** ${dateLabel}\n\n${intro}---\n\n${summaryToMarkdown(exec)}`;

  let body: string;
  if (content === "resumo") {
    body = format === "md" ? resumoMd() : resumoTxt();
  } else if (content === "completo") {
    body =
      format === "md"
        ? `${resumoMd()}\n---\n\n## Transcrição\n\n` +
          `**Participantes:** ${participantNames(segments, labels).join(", ")}\n\n` +
          `${turnsToMarkdown(segments, labels)}\n`
        : `${resumoTxt()}\n\nTRANSCRIÇÃO\n\n${toPlainText(segments, labels)}\n`;
  } else if (format === "txt") body = toPlainText(segments, labels);
  else if (format === "srt") body = toSrt(segments, labels);
  else if (format === "vtt") body = toVtt(segments, labels);
  else
    body = toMarkdown(segments, labels, {
      title: (m.summary || "Reunião") + titleSuffix,
      dateLabel,
      participants: participantNames(segments, labels),
    });

  const datePart = m.recorded_at ? m.recorded_at.slice(0, 10) : "sem-data";
  const filename = `${CONTENTS[content]}-${datePart}.${FORMATS[format].ext}`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": FORMATS[format].mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

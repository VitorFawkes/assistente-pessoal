// Monta o arquivo de download de uma reunião (resumo, transcrição ou os dois).
//
// Vive fora da rota porque o dono (/api/meetings/[id]/export) e o convidado
// (/api/r/[token]/export) baixam exatamente o mesmo arquivo — só a porta de
// entrada muda. Duas cópias divergiriam no primeiro ajuste de formato.
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
  type Segment,
} from "@/lib/transcript-format";
import { summaryToMarkdown, summaryToPlainText } from "@/lib/summary-format";

export const FORMATS = {
  txt: { ext: "txt", mime: "text/plain; charset=utf-8" },
  srt: { ext: "srt", mime: "application/x-subrip; charset=utf-8" },
  vtt: { ext: "vtt", mime: "text/vtt; charset=utf-8" },
  md: { ext: "md", mime: "text/markdown; charset=utf-8" },
} as const;

// O que vai no arquivo — e o prefixo do nome dele.
export const CONTENTS = {
  transcricao: "reuniao",
  resumo: "resumo",
  completo: "reuniao-completa",
} as const;

export type ExportFormat = keyof typeof FORMATS;
export type ExportContent = keyof typeof CONTENTS;

/** Linha crua vinda de meetingsFor(...).forExport / do resolver do convidado. */
export type MeetingExportRow = {
  summary: string | null;
  executive_summary: string | null;
  duration_seconds: number | null;
  recorded_at: string | null;
  segments: unknown;
  speaker_labels: Record<string, string> | null;
  sections: unknown;
};

export type ExportRequest = {
  content: ExportContent;
  format: ExportFormat;
  scope?: string | null;
  section?: number;
};

export type ExportResult =
  | { ok: true; body: string; filename: string; mime: string }
  | { ok: false; status: number; error: string };

export function coerceSections(raw: unknown): { start_seconds: number; title: string }[] {
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

/** Valida os parâmetros crus da URL. Devolve o pedido ou o erro pronto. */
export function parseExportRequest(
  params: URLSearchParams,
): { ok: true; req: ExportRequest } | { ok: false; status: number; error: string } {
  const format = (params.get("format") || "txt") as ExportFormat;
  if (!FORMATS[format]) return { ok: false, status: 400, error: "format inválido" };

  const content = (params.get("content") || "transcricao") as ExportContent;
  if (!CONTENTS[content]) return { ok: false, status: 400, error: "content inválido" };

  // Legenda só faz sentido colada no áudio — resumo não tem timestamp.
  if (content !== "transcricao" && format !== "txt" && format !== "md") {
    return { ok: false, status: 400, error: "resumo só sai em txt ou md" };
  }

  return {
    ok: true,
    req: {
      content,
      format,
      scope: params.get("scope") || "full",
      section: Number(params.get("section")),
    },
  };
}

export function buildMeetingExport(m: MeetingExportRow, req: ExportRequest): ExportResult {
  const { content, format } = req;

  const allSegments = coerceSegments(m.segments);
  if (content !== "resumo" && allSegments.length === 0) {
    return { ok: false, status: 422, error: "sem transcrição" };
  }
  if (content !== "transcricao" && !m.executive_summary) {
    return { ok: false, status: 422, error: "sem resumo" };
  }
  const labels = m.speaker_labels || {};
  const sections = coerceSections(m.sections);

  let segments: Segment[] = allSegments;
  let titleSuffix = "";
  if (
    content === "transcricao" &&
    req.scope === "section" &&
    Number.isInteger(req.section) &&
    sections[req.section as number]
  ) {
    const idx = req.section as number;
    segments = filterBySection(allSegments, sections, idx, m.duration_seconds || 0);
    titleSuffix = ` — ${sections[idx].title}`;
    if (segments.length === 0) return { ok: false, status: 422, error: "seção vazia" };
  }

  const dateLabel = m.recorded_at ? fmtDate(m.recorded_at) : "sem data";
  // Na tela o título é o assunto e o parágrafo da IA vem logo abaixo — o
  // arquivo repete essa ordem pra abrir igual ao que ele viu.
  const subject = meetingSubject(m.summary) || "Reunião";
  const intro = m.summary ? `${m.summary}\n\n` : "";
  const exec = m.executive_summary || "";

  const resumoTxt = () => `${subject}\n${dateLabel}\n\n${intro}${summaryToPlainText(exec)}`;
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
  return {
    ok: true,
    body,
    filename: `${CONTENTS[content]}-${datePart}.${FORMATS[format].ext}`,
    mime: FORMATS[format].mime,
  };
}

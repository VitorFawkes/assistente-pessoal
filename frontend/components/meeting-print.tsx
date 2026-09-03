import { fmtDate } from "@/lib/utils";
import {
  coerceSegments,
  groupTurns,
  speakerName,
  fmtClock,
  filterBySection,
} from "@/lib/transcript-format";
import { meetingSubject } from "@/lib/meeting-label";
import { Markdown } from "@/lib/md";
import { coerceSections, type ExportContent, type MeetingExportRow } from "@/lib/meeting-export";

/**
 * Folha de impressão da reunião — vira PDF pelo "Salvar como PDF" do navegador.
 * Compartilhada entre o dono (/reunioes/[id]/imprimir) e quem recebe o link
 * (/r/[token]/imprimir), e recortada por `content` + `section`: quem escolheu
 * "só o resumo" não pode receber a transcrição inteira no papel.
 */
export function MeetingPrintSheet({
  meeting,
  content,
  section = null,
}: {
  meeting: MeetingExportRow;
  content: ExportContent;
  section?: number | null;
}) {
  const todos = coerceSegments(meeting.segments);
  const sections = coerceSections(meeting.sections);
  const labels = meeting.speaker_labels || {};

  const recortado =
    content === "transcricao" && section !== null && sections[section]
      ? filterBySection(
          todos,
          sections,
          section,
          meeting.duration_seconds || todos.reduce((max, s) => Math.max(max, s.end), 0),
        )
      : todos;

  const turns = content === "resumo" ? [] : groupTurns(recortado);
  const mostrarResumo = content !== "transcricao" && !!meeting.executive_summary;
  const tituloTrecho = section !== null ? sections[section]?.title : null;

  return (
    <div className="mx-auto max-w-3xl p-8 text-black bg-white print:p-0">
      <header className="mb-6">
        {/* No papel valia o mesmo: o resumo inteiro como título tomava meia
            página antes da transcrição começar. */}
        <h1 className="text-2xl font-semibold">
          {meetingSubject(meeting.summary) || "Reunião"}
        </h1>
        <p className="text-sm text-neutral-600 mt-1">
          {meeting.recorded_at ? fmtDate(meeting.recorded_at) : "sem data"}
        </p>
        {meeting.summary && (
          <p className="text-sm text-neutral-700 mt-2 leading-relaxed">{meeting.summary}</p>
        )}
      </header>

      {/* O resumo é o que ele lê primeiro na tela — no papel também vem antes
          da transcrição, senão o PDF sai só com as falas cruas. */}
      {mostrarResumo && (
        <section className="mb-8 text-[14px]">
          <h2 className="text-[11px] tracking-[0.18em] uppercase text-neutral-500 mb-2">
            Resumo executivo
          </h2>
          <Markdown text={meeting.executive_summary || ""} />
        </section>
      )}

      {turns.length > 0 && (
        <h2 className="text-[11px] tracking-[0.18em] uppercase text-neutral-500 mb-2">
          Transcrição{tituloTrecho ? ` — ${tituloTrecho}` : ""}
        </h2>
      )}
      <div className="space-y-3">
        {turns.map((t, i) => (
          <p key={i} className="text-[14px] leading-relaxed">
            <span className="font-mono text-neutral-500 text-[12px]">[{fmtClock(t.start)}]</span>{" "}
            <strong>{speakerName(t.speaker, labels)}:</strong> {t.text.trim()}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Lê `?content=&scope=&section=` da folha de impressão (mesmo vocabulário do download). */
export function parsePrintParams(sp: {
  content?: string;
  scope?: string;
  section?: string;
}): { content: ExportContent; section: number | null } {
  const content: ExportContent =
    sp.content === "resumo" || sp.content === "transcricao" ? sp.content : "completo";
  const n = Number(sp.section);
  const section = sp.scope === "section" && Number.isInteger(n) && n >= 0 ? n : null;
  return { content, section };
}

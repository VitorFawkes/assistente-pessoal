import { Link2, CheckCircle2, Circle, Clock } from "lucide-react";
import { fmtDate, formatPrazo, formatPrazoColor, normalizeOwner, areaLabel } from "@/lib/utils";
import { meetingSubject } from "@/lib/meeting-label";
import { Markdown } from "@/lib/md";
import {
  coerceSegments,
  groupTurns,
  speakerName,
  fmtClock,
  type Segment,
} from "@/lib/transcript-format";
import type { Tarefa } from "@/lib/queries";
import { MeetingExportMenu } from "@/components/meeting-export-menu";

export type ReuniaoCompartilhada = {
  summary: string | null;
  executive_summary: string | null;
  recorded_at: string | null;
  duration_seconds: number | null;
  segments: unknown;
  speaker_labels: Record<string, string> | null;
  sections: { start_seconds: number; title: string }[] | null;
};

/**
 * A reunião como quem recebeu o link vê: leitura e download, nada de editar.
 * Não reusa TaskRow/TranscriptionView de propósito — os dois só existem
 * apoiados num contexto de mutação, e aqui não há nenhuma escrita possível.
 */
export function MeetingGuestView({
  token,
  meeting,
  tarefas,
  donoNome,
}: {
  token: string;
  meeting: ReuniaoCompartilhada;
  tarefas: Tarefa[];
  donoNome: string | null;
}) {
  const segments: Segment[] = coerceSegments(meeting.segments);
  const labels = meeting.speaker_labels || {};
  const turns = groupTurns(segments);
  const minutos =
    meeting.duration_seconds && meeting.duration_seconds > 0
      ? Math.max(1, Math.round(meeting.duration_seconds / 60))
      : null;

  return (
    <div className="space-y-7 sm:space-y-9">
      <div className="flex items-center gap-2 text-[12px] text-[color:var(--muted)]">
        <Link2 size={13} className="shrink-0" />
        <span>
          {donoNome ? `${donoNome} compartilhou esta reunião com você.` : "Reunião compartilhada."}{" "}
          Você pode ler e baixar.
        </span>
      </div>

      <header className="space-y-3">
        <h1 className="font-display text-2xl sm:text-3xl leading-[1.2] tracking-tight">
          {meetingSubject(meeting.summary) || "Reunião"}
        </h1>
        <div className="flex items-center gap-2 flex-wrap text-[13px] text-[color:var(--muted-strong)]">
          {meeting.recorded_at && <span>{fmtDate(meeting.recorded_at)}</span>}
          {minutos && (
            <>
              <span>·</span>
              <span>{minutos} min</span>
            </>
          )}
        </div>
        {meeting.summary && (
          <p className="text-[13px] leading-relaxed text-[color:var(--muted-strong)]">
            {meeting.summary}
          </p>
        )}
      </header>

      {meeting.executive_summary && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
              Resumo executivo
            </h2>
            <MeetingExportMenu
              segments={segments}
              labels={labels}
              sections={meeting.sections || []}
              summaryMd={meeting.executive_summary}
              duracao={meeting.duration_seconds || 0}
              exportBase={`/api/r/${token}/export`}
              printBase={`/r/${token}/imprimir`}
            />
          </div>
          <div className="paper-card rounded-2xl border border-[color:var(--border)] p-5 sm:p-6">
            <Markdown text={meeting.executive_summary} />
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Ações ({tarefas.length})
        </h2>
        {tarefas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center">
            <p className="text-sm text-[color:var(--muted)]">
              Nenhuma ação foi extraída desta gravação.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tarefas.map((t) => (
              <TarefaLeitura key={t.id} tarefa={t} />
            ))}
          </div>
        )}
      </section>

      {turns.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
              Transcrição
            </h2>
            {!meeting.executive_summary && (
              <MeetingExportMenu
                segments={segments}
                labels={labels}
                sections={meeting.sections || []}
                summaryMd={null}
                duracao={meeting.duration_seconds || 0}
                exportBase={`/api/r/${token}/export`}
                printBase={`/r/${token}/imprimir`}
              />
            )}
          </div>
          <div className="paper-card rounded-2xl border border-[color:var(--border)] p-5 space-y-3">
            {turns.map((t, i) => (
              <p key={i} className="text-[13px] leading-relaxed">
                <span className="font-mono text-[color:var(--muted)] text-[11px]">
                  [{fmtClock(t.start)}]
                </span>{" "}
                <strong>{speakerName(t.speaker, labels)}:</strong> {t.text.trim()}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function stripe(p: Tarefa["prioridade"]): string {
  if (p === "urgente") return "bg-[color:var(--urgent)]";
  if (p === "alta") return "bg-[color:var(--warm)]";
  if (p === "media") return "bg-[color:var(--muted)] opacity-30";
  return "bg-[color:var(--muted)] opacity-15";
}

function TarefaLeitura({ tarefa }: { tarefa: Tarefa }) {
  const feita = tarefa.status === "concluida" || tarefa.status === "cancelada";
  const prazo = formatPrazo(tarefa.prazo);
  const principal = tarefa.pessoas.find((p) => p.principal)?.nome;
  const dono = principal || normalizeOwner(tarefa.owner);
  const area = tarefa.frente ? areaLabel(tarefa.frente) : null;

  return (
    <div
      className={`paper-card rounded-xl border border-[color:var(--border)] overflow-hidden flex items-stretch ${
        feita ? "opacity-55" : ""
      }`}
    >
      <div className={`w-1.5 shrink-0 ${stripe(tarefa.prioridade)}`} aria-hidden />
      <div className="shrink-0 flex items-start justify-center w-9 pt-2.5 text-[color:var(--muted)]">
        {feita ? (
          <CheckCircle2 size={18} strokeWidth={2} className="text-[color:var(--calm)]" />
        ) : (
          <Circle size={18} strokeWidth={1.75} />
        )}
      </div>
      <div className="flex-1 min-w-0 py-2 pr-3 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p
            className={`text-[13px] leading-snug flex-1 min-w-0 ${
              feita ? "line-through" : ""
            }`}
          >
            {tarefa.titulo}
          </p>
          {tarefa.prazo && (
            <span
              className={`shrink-0 inline-flex items-center gap-1 text-[11px] ${formatPrazoColor(
                prazo.status,
              )}`}
            >
              <Clock size={11} /> {prazo.text}
            </span>
          )}
        </div>
        {tarefa.descricao && (
          <p className="text-[12px] leading-snug text-[color:var(--muted-strong)]">
            {tarefa.descricao}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[color:var(--muted)]">
          {dono && (
            <span className="px-1.5 py-0.5 rounded-full bg-[color:var(--accent)]">{dono}</span>
          )}
          {area && (
            <span className="px-1.5 py-0.5 rounded-full bg-[color:var(--accent)]">{area}</span>
          )}
        </div>
      </div>
    </div>
  );
}

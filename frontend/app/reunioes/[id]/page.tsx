import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { meetingsFor, tarefasFor, pessoasFor } from "@/lib/queries";
import { fmtDate } from "@/lib/utils";
import { meetingSubject } from "@/lib/meeting-label";
import { TaskRow, type Tarefa } from "@/components/task-row";
import { TaskGroupByPerson } from "@/components/task-group-by-person";
import { MeetingTaskSummary } from "@/components/meeting-task-summary";
import {
  TranscriptionView,
  type Segment,
  type ProposedLabel,
} from "@/components/transcription-view";
import { SpeakersStrip } from "@/components/speakers-strip";
import { buildSpeakerCards } from "@/lib/speakers";
import { ArrowLeft, Mic, Video, FileQuestion, UsersRound } from "lucide-react";
import { ExecutiveSummary } from "./executive-summary";
import { AutoLabelByContent } from "./auto-label-by-content";
import { DeleteMeetingButton } from "@/components/delete-meeting-button";
import { MeetingExportMenu } from "@/components/meeting-export-menu";
import { RegenerateButton } from "@/components/regenerate-button";
import { OwnerTaskProvider } from "@/lib/task-mutations";

export const dynamic = "force-dynamic";

type Meeting = {
  id: string;
  source: string;
  meeting_type: string | null;
  original_filename: string;
  recorded_at: string | null;
  created_at: string;
  status: string;
  status_error: string | null;
  transcription: string | null;
  summary: string | null;
  executive_summary: string | null;
  duration_seconds: number | null;
  segments: Segment[] | null;
  speaker_labels: Record<string, string> | null;
  speaker_labels_proposed: Record<string, ProposedLabel | null> | null;
  sections: { start_seconds: number; title: string }[] | null;
  segments_removidos_count: number;
};

function MeetingTypeIcon({ type }: { type: string | null }) {
  if (type === "online") return <Video size={14} strokeWidth={1.75} />;
  if (type === "presencial") return <Mic size={14} strokeWidth={1.75} />;
  return <FileQuestion size={14} strokeWidth={1.75} />;
}

export default async function ReuniaoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUserOrRedirect();
  const meeting = (await meetingsFor(user.id).byIdDetailed(id)) as Meeting | null;
  if (!meeting) notFound();

  const [tarefas, pessoas] = await Promise.all([
    tarefasFor(user.id).byMeeting(id) as Promise<Tarefa[]>,
    pessoasFor(user.id).listMinimal(),
  ]);
  const aberta = (t: Tarefa) => t.status !== "concluida" && t.status !== "cancelada";
  const suas = tarefas.filter((t) => aberta(t) && t.acao !== "aguardar");
  const aguardando = tarefas.filter((t) => aberta(t) && t.acao === "aguardar");
  const concluidas = tarefas.filter((t) => !aberta(t));

  const typeLabel =
    meeting.meeting_type === "online"
      ? "online"
      : meeting.meeting_type === "presencial"
      ? "presencial"
      : "voice note";

  const speakerCards =
    meeting.segments && meeting.segments.length > 0
      ? buildSpeakerCards(meeting.segments, meeting.speaker_labels || {})
      : [];

  // speakers sem nome + resumo pronto → tenta rotular pela conversa (fallback da voz)
  const labeled = meeting.speaker_labels || {};
  const hasBlankSpeakers =
    speakerCards.length > 0 &&
    [...new Set((meeting.segments || []).map((s) => s.speaker).filter(Boolean))].some(
      (sp) => !labeled[sp as string],
    );

  return (
    <OwnerTaskProvider>
    <div className="space-y-7 sm:space-y-9">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/reunioes"
          className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
        >
          <ArrowLeft size={14} /> reuniões
        </Link>
        <DeleteMeetingButton meetingId={meeting.id} redirectTo="/reunioes" label="deletar" />
      </div>

      {/* HEADER da reunião */}
      <header className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted)]">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)] normal-case tracking-normal text-[12px]">
            <MeetingTypeIcon type={meeting.meeting_type} />
            {typeLabel}
          </span>
          <span>·</span>
          <span>via {meeting.source}</span>
          {meeting.duration_seconds && meeting.duration_seconds > 0 ? (
            <>
              <span>·</span>
              <span>{Math.max(1, Math.round(meeting.duration_seconds / 60))} min</span>
            </>
          ) : null}
        </div>

        {/* Título = o assunto. O resumo inteiro como h1 tomava 6 linhas e
            fazia toda reunião "começar igual" em qualquer lista. */}
        <h1 className="font-display text-2xl sm:text-3xl leading-[1.2] tracking-tight">
          {meetingSubject(meeting.summary) || "Reunião sem resumo"}
        </h1>

        <div className="space-y-1">
          {meeting.recorded_at && (
            <p className="text-[13px] text-[color:var(--muted-strong)]">
              {fmtDate(meeting.recorded_at)}
            </p>
          )}
          {meeting.summary && (
            <p className="text-[13px] leading-relaxed text-[color:var(--muted-strong)]">
              {meeting.summary}
            </p>
          )}
          <p className="sr-only">{meeting.original_filename}</p>
        </div>

        {/* Player de áudio — full width abaixo do título */}
        <div className="paper-card rounded-2xl border border-[color:var(--border)] p-3 sm:p-4">
          <audio
            controls
            className="w-full"
            preload="metadata"
            src={`/api/audio/${meeting.id}`}
          >
            seu navegador não suporta áudio
          </audio>
        </div>

        {meeting.status_error && (
          <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-4">
            <p className="text-[12px] text-[color:var(--urgent)]">
              ⚠️ {meeting.status_error}
            </p>
          </div>
        )}
      </header>

      {/* SPEAKERS INLINE — escutar/identificar sem sair da página */}
      {speakerCards.length > 0 && (
        <div className="space-y-2">
          <SpeakersStrip
            meetingId={meeting.id}
            speakers={speakerCards}
            pessoas={pessoas}
            speakerLabelsProposed={meeting.speaker_labels_proposed || {}}
          />
          <AutoLabelByContent
            meetingId={meeting.id}
            enabled={hasBlankSpeakers && !!meeting.executive_summary}
          />
        </div>
      )}

      {/* RESUMO EXECUTIVO */}
      {meeting.executive_summary && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
              Resumo executivo
            </h2>
            <div className="flex items-center gap-2">
              <RegenerateButton meetingId={meeting.id} tarefasCount={tarefas.length} />
              <MeetingExportMenu
                meetingId={meeting.id}
                segments={meeting.segments || []}
                labels={meeting.speaker_labels || {}}
                sections={meeting.sections || []}
                summaryMd={meeting.executive_summary}
                label="baixar resumo"
              />
            </div>
          </div>
          <div className="paper-card rounded-2xl border border-[color:var(--border)] p-5 sm:p-6">
            <ExecutiveSummary md={meeting.executive_summary} meetingId={meeting.id} />
          </div>
        </section>
      )}

      {/* AÇÕES */}
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
          <div className="space-y-6">
            <MeetingTaskSummary tarefas={tarefas} />

            {suas.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted-strong)]">
                  Suas ({suas.length})
                </h3>
                <TaskGroupByPerson tarefas={suas} />
              </div>
            )}
            {aguardando.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted-strong)]">
                  Aguardando outros ({aguardando.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {aguardando.map((t) => (
                    <TaskRow key={t.id} tarefa={t} />
                  ))}
                </div>
              </div>
            )}
            {concluidas.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted-strong)]">
                  Finalizadas ({concluidas.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {concluidas.map((t) => (
                    <TaskRow key={t.id} tarefa={t} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* TRANSCRIÇÃO */}
      {meeting.transcription && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
              Transcrição
            </h2>
            {meeting.segments && meeting.segments.length > 0 && (
              <div className="flex items-center gap-2">
                <Link
                  href={`/reunioes/${meeting.id}/identificar`}
                  className="press-feedback inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:ring-1 hover:ring-[color:var(--foreground)]/30"
                  title="Tela dedicada pra ouvir trechos curtos e rotular speakers"
                >
                  <UsersRound size={13} /> identificar speakers
                </Link>
                <MeetingExportMenu
                  meetingId={meeting.id}
                  segments={meeting.segments}
                  labels={meeting.speaker_labels || {}}
                  sections={meeting.sections || []}
                  summaryMd={meeting.executive_summary}
                />
              </div>
            )}
          </div>
          <div className="paper-card rounded-2xl border border-[color:var(--border)] p-5">
            <TranscriptionView
              meetingId={meeting.id}
              segments={meeting.segments}
              initialLabels={meeting.speaker_labels || {}}
              speakerLabelsProposed={meeting.speaker_labels_proposed || {}}
              pessoas={pessoas}
              fallbackText={meeting.transcription}
              sections={meeting.sections || []}
              removidosCount={meeting.segments_removidos_count ?? 0}
            />
          </div>
        </section>
      )}
    </div>
    </OwnerTaskProvider>
  );
}

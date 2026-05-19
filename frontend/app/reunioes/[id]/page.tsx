import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { fmtDate } from "@/lib/utils";
import { TaskRow, type Tarefa } from "@/components/task-row";
import { TranscriptionView, type Segment } from "@/components/transcription-view";
import { ArrowLeft, Mic, Video, FileQuestion } from "lucide-react";

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
  duration_seconds: number | null;
  segments: Segment[] | null;
  speaker_labels: Record<string, string> | null;
};

async function fetchMeeting(id: string): Promise<Meeting | null> {
  const rows = await query<Meeting>(
    `
    SELECT
      id, source, meeting_type, original_filename,
      to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
      status, status_error, transcription, summary, duration_seconds, segments, speaker_labels
    FROM meetings WHERE id = $1
    `,
    [id],
  );
  return rows[0] ?? null;
}

async function fetchTarefasOfMeeting(id: string): Promise<Tarefa[]> {
  return query<Tarefa>(
    `
    SELECT
      id, meeting_id, titulo, descricao, owner, is_mine,
      to_char(prazo AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS prazo,
      prazo_text, prioridade, status, evidencia,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
    FROM tarefas
    WHERE meeting_id = $1
    ORDER BY (status NOT IN ('aberta','em_andamento')), is_mine DESC, (prazo IS NULL), prazo ASC, created_at ASC
    `,
    [id],
  );
}

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
  const meeting = await fetchMeeting(id);
  if (!meeting) notFound();

  const tarefas = await fetchTarefasOfMeeting(id);
  const minhas = tarefas.filter((t) => t.is_mine && t.status !== "concluida" && t.status !== "cancelada");
  const delegadas = tarefas.filter((t) => !t.is_mine && t.status !== "concluida" && t.status !== "cancelada");
  const concluidas = tarefas.filter((t) => t.status === "concluida" || t.status === "cancelada");

  const typeLabel =
    meeting.meeting_type === "online"
      ? "online"
      : meeting.meeting_type === "presencial"
      ? "presencial"
      : "voice note";

  return (
    <div className="space-y-7 sm:space-y-9">
      <Link
        href="/reunioes"
        className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
      >
        <ArrowLeft size={14} /> reuniões
      </Link>

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

        <h1 className="font-display text-2xl sm:text-3xl leading-[1.2] tracking-tight">
          {meeting.summary || "Reunião sem resumo"}
        </h1>

        <div className="space-y-1">
          {meeting.recorded_at && (
            <p className="text-[13px] text-[color:var(--muted-strong)]">
              {fmtDate(meeting.recorded_at)}
            </p>
          )}
          <p className="text-[11px] text-[color:var(--muted)] font-mono">
            {meeting.original_filename}
          </p>
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
            {minhas.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted-strong)]">
                  Minhas ({minhas.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {minhas.map((t) => (
                    <TaskRow key={t.id} tarefa={t} />
                  ))}
                </div>
              </div>
            )}
            {delegadas.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted-strong)]">
                  Aguardando outros ({delegadas.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {delegadas.map((t) => (
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
          <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
            Transcrição
          </h2>
          <div className="paper-card rounded-2xl border border-[color:var(--border)] p-5">
            <TranscriptionView
              meetingId={meeting.id}
              segments={meeting.segments}
              initialLabels={meeting.speaker_labels || {}}
              fallbackText={meeting.transcription}
            />
          </div>
        </section>
      )}
    </div>
  );
}

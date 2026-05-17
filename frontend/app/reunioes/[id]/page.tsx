import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { fmtDate } from "@/lib/utils";
import { TaskRow, type Tarefa } from "@/components/task-row";
import { ArrowLeft } from "lucide-react";

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
};

async function fetchMeeting(id: string): Promise<Meeting | null> {
  const rows = await query<Meeting>(
    `
    SELECT
      id, source, meeting_type, original_filename,
      to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
      status, status_error, transcription, summary, duration_seconds
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
    ORDER BY is_mine DESC, (prazo IS NULL), prazo ASC, created_at ASC
    `,
    [id],
  );
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
  const minhas = tarefas.filter((t) => t.is_mine);
  const delegadas = tarefas.filter((t) => !t.is_mine);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reunioes"
          className="inline-flex items-center gap-1 text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
        >
          <ArrowLeft size={14} /> reuniões
        </Link>
      </div>

      <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[color:var(--muted)]">
              {meeting.recorded_at && fmtDate(meeting.recorded_at)}
              {" · "}
              {meeting.meeting_type === "online"
                ? "online"
                : meeting.meeting_type === "presencial"
                ? "presencial"
                : "desconhecido"}
              {" · via "}
              {meeting.source}
              {meeting.duration_seconds
                ? ` · ${Math.round(meeting.duration_seconds / 60)} min`
                : ""}
            </p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight">
              {meeting.summary || "Reunião sem resumo"}
            </h1>
            <p className="mt-1 text-xs text-[color:var(--muted)] font-mono">
              {meeting.original_filename}
            </p>
          </div>
          <audio controls className="max-w-xs" src={`/api/audio/${meeting.id}`}>
            seu navegador não suporta áudio
          </audio>
        </div>
        {meeting.status_error && (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400">
            ⚠️ Erro: {meeting.status_error}
          </p>
        )}
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Ações ({tarefas.length})</h2>
        {tarefas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[color:var(--border)] p-8 text-center text-sm text-[color:var(--muted)]">
            Nenhuma ação foi extraída desta reunião.
          </div>
        ) : (
          <div className="space-y-4">
            {minhas.length > 0 && (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)] mb-2">
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
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)] mb-2">
                  Combinei com outros ({delegadas.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {delegadas.map((t) => (
                    <TaskRow key={t.id} tarefa={t} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {meeting.transcription && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Transcrição</h2>
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-5">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--foreground)]">
              {meeting.transcription}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

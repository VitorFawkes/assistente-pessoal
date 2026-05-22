import Link from "next/link";
import { ArrowLeft, Mic, Video, FileQuestion, Scissors } from "lucide-react";
import { query } from "@/lib/db";
import { fmtDate } from "@/lib/utils";
import { RestoreButton } from "./restore-button";

export const dynamic = "force-dynamic";

type ArchivedMeeting = {
  id: string;
  source: string;
  meeting_type: string | null;
  recorded_at: string | null;
  summary: string | null;
  duration_seconds: number | null;
  n_segments: number;
};

async function fetchArchived(): Promise<ArchivedMeeting[]> {
  return query<ArchivedMeeting>(`
    SELECT
      m.id, m.source, m.meeting_type,
      to_char(coalesce(m.recorded_at, m.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
      m.summary, m.duration_seconds,
      (SELECT count(*) FROM meetings c WHERE c.parent_meeting_id = m.id)::int AS n_segments
    FROM meetings m
    WHERE m.status = 'archived_session'
      AND m.parent_meeting_id IS NULL
    ORDER BY coalesce(m.recorded_at, m.created_at) DESC
    LIMIT 100;
  `);
}

function MeetingIcon({ type }: { type: string | null }) {
  if (type === "online")
    return <Video size={16} strokeWidth={1.75} className="text-[color:var(--muted-strong)]" />;
  if (type === "presencial")
    return <Mic size={16} strokeWidth={1.75} className="text-[color:var(--muted-strong)]" />;
  return <FileQuestion size={16} strokeWidth={1.75} className="text-[color:var(--muted)]" />;
}

export default async function ArquivadasPage() {
  let meetings: ArchivedMeeting[] = [];
  let error: string | null = null;
  try {
    meetings = await fetchArchived();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-6">
        <h2 className="text-sm font-semibold text-[color:var(--urgent)]">
          Erro ao carregar arquivadas
        </h2>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-[color:var(--urgent)]/90">
          {error}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-7 sm:space-y-9">
      <Link
        href="/reunioes"
        className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
      >
        <ArrowLeft size={14} /> voltar pras reuniões
      </Link>

      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Arquivadas
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          Sessões que{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            saíram da lista.
          </span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Sessões originais arquivadas — por terem sido fatiadas em reuniões
          menores, ou descartadas via &ldquo;arquivar sem segmentar&rdquo;.
          Restaurar traz a sessão original de volta pra lista principal.
        </p>
      </header>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-12 text-center">
          <p className="text-sm text-[color:var(--muted)]">
            Nenhuma sessão arquivada.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {meetings.map((m) => {
            const segmented = m.n_segments > 0;
            return (
              <div
                key={m.id}
                className="paper-card rounded-2xl border border-[color:var(--border)] p-4 sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-[color:var(--accent)] flex items-center justify-center">
                    <MeetingIcon type={m.meeting_type} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] leading-snug text-[color:var(--foreground)] line-clamp-2">
                      {m.summary || "Sessão sem resumo"}
                    </p>
                    <div className="mt-2 flex items-center flex-wrap gap-x-3 gap-y-1 text-[12px] text-[color:var(--muted)]">
                      {m.recorded_at && <span>{fmtDate(m.recorded_at)}</span>}
                      {m.duration_seconds && m.duration_seconds > 0 ? (
                        <span>· {Math.max(1, Math.round(m.duration_seconds / 60))} min</span>
                      ) : null}
                      {segmented && (
                        <span className="inline-flex items-center gap-1 text-[color:var(--warm)]">
                          · <Scissors size={11} /> fatiada em {m.n_segments}{" "}
                          {m.n_segments === 1 ? "reunião" : "reuniões"}
                        </span>
                      )}
                    </div>
                    {segmented && (
                      <p className="mt-2 text-[11px] text-[color:var(--muted)] max-w-md">
                        Restaurar essa sessão vai trazê-la de volta sem apagar
                        as reuniões filhas — pode gerar tarefas duplicadas.
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 self-center">
                    <RestoreButton meetingId={m.id} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

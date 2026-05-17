import Link from "next/link";
import { query } from "@/lib/db";
import { fmtDate } from "@/lib/utils";
import { Mic, Video, FileQuestion } from "lucide-react";

export const dynamic = "force-dynamic";

type Meeting = {
  id: string;
  source: string;
  meeting_type: string | null;
  recorded_at: string | null;
  created_at: string;
  status: string;
  summary: string | null;
  duration_seconds: number | null;
  n_tarefas: number;
  n_minhas: number;
};

async function fetchMeetings(): Promise<Meeting[]> {
  return query<Meeting>(`
    SELECT
      m.id, m.source, m.meeting_type,
      to_char(coalesce(m.recorded_at, m.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
      to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
      m.status, m.summary, m.duration_seconds,
      (SELECT count(*) FROM tarefas WHERE meeting_id = m.id)::int AS n_tarefas,
      (SELECT count(*) FROM tarefas WHERE meeting_id = m.id AND owner = 'vitor')::int AS n_minhas
    FROM meetings m
    ORDER BY coalesce(m.recorded_at, m.created_at) DESC
    LIMIT 100;
  `);
}

function MeetingIcon({ type }: { type: string | null }) {
  if (type === "online") return <Video size={16} className="text-blue-500" />;
  if (type === "presencial") return <Mic size={16} className="text-amber-500" />;
  return <FileQuestion size={16} className="text-zinc-400" />;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    received: { cls: "bg-zinc-100 text-zinc-600", label: "recebida" },
    transcribing: { cls: "bg-blue-100 text-blue-700", label: "transcrevendo" },
    analyzing: { cls: "bg-amber-100 text-amber-700", label: "analisando" },
    done: { cls: "bg-emerald-100 text-emerald-700", label: "pronta" },
    error: { cls: "bg-red-100 text-red-700", label: "erro" },
  };
  const s = map[status] ?? map.received;
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

export default async function ReunioesPage() {
  let meetings: Meeting[] = [];
  let error: string | null = null;
  try {
    meetings = await fetchMeetings();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h2 className="text-sm font-semibold text-red-700">Erro ao carregar reuniões</h2>
        <pre className="mt-2 text-xs text-red-600">{error}</pre>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reuniões</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          Histórico das reuniões processadas pelo pipeline.
        </p>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[color:var(--border)] p-12 text-center">
          <p className="text-sm text-[color:var(--muted)]">
            Nenhuma reunião processada ainda. Grave um áudio na pasta{" "}
            <code className="text-xs">~/Documents/AudiosMacbook</code> que aparece aqui.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] overflow-hidden">
          {meetings.map((m, idx) => (
            <Link
              key={m.id}
              href={`/reunioes/${m.id}`}
              className={`flex items-center gap-4 p-4 hover:bg-[color:var(--accent)] transition ${
                idx < meetings.length - 1 ? "border-b border-[color:var(--border)]" : ""
              }`}
            >
              <MeetingIcon type={m.meeting_type} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">
                    {m.summary || "Reunião sem resumo"}
                  </p>
                  <StatusPill status={m.status} />
                </div>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                  {m.recorded_at && fmtDate(m.recorded_at)}
                  {m.duration_seconds ? ` · ${Math.round(m.duration_seconds / 60)} min` : ""}
                  {" · "}
                  <span className="text-[color:var(--foreground)] font-medium">
                    {m.n_tarefas}
                  </span>{" "}
                  {m.n_tarefas === 1 ? "ação" : "ações"}
                  {m.n_minhas > 0 && (
                    <span>
                      {" "}
                      (<span className="text-[color:var(--foreground)]">{m.n_minhas}</span> minhas)
                    </span>
                  )}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

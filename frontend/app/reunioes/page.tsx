import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";
import { fmtDate } from "@/lib/utils";
import { Mic, Video, FileQuestion, ChevronRight } from "lucide-react";

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
  needs_segmentation: boolean;
  n_tarefas: number;
  n_minhas: number;
};

function MeetingIcon({ type }: { type: string | null }) {
  if (type === "online")
    return <Video size={16} strokeWidth={1.75} className="text-[color:var(--muted-strong)]" />;
  if (type === "presencial")
    return <Mic size={16} strokeWidth={1.75} className="text-[color:var(--muted-strong)]" />;
  return (
    <FileQuestion
      size={16}
      strokeWidth={1.75}
      className="text-[color:var(--muted)]"
    />
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    received: {
      cls: "bg-[color:var(--accent)] text-[color:var(--muted-strong)]",
      label: "recebida",
    },
    transcribing: {
      cls: "bg-[color:var(--warm-bg)] text-[color:var(--warm)]",
      label: "transcrevendo",
    },
    analyzing: {
      cls: "bg-[color:var(--warm-bg)] text-[color:var(--warm)]",
      label: "analisando",
    },
    done: {
      cls: "bg-[color:var(--calm-bg)] text-[color:var(--calm)]",
      label: "pronta",
    },
    error: {
      cls: "bg-[color:var(--urgent-bg)] text-[color:var(--urgent)]",
      label: "erro",
    },
  };
  const s = map[status] ?? map.received;
  return (
    <span
      className={`text-[10px] tracking-wide uppercase px-2 py-0.5 rounded-full font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

export default async function ReunioesPage() {
  const user = await requireUserOrRedirect();
  let meetings: Meeting[] = [];
  let error: string | null = null;
  try {
    meetings = await meetingsFor(user.id).listForIndex();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-6">
        <h2 className="text-sm font-semibold text-[color:var(--urgent)]">
          Erro ao carregar reuniões
        </h2>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-[color:var(--urgent)]/90">
          {error}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Reuniões
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          Histórico do que{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            foi capturado.
          </span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Reuniões e voice notes processados pelo pipeline, do mais recente pro
          mais antigo.
        </p>
      </header>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-12 text-center">
          <p className="text-sm text-[color:var(--muted)]">
            Nenhuma reunião processada ainda. Grave um áudio pra ele aparecer
            aqui em ~30s.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {meetings.map((m) => (
            <div key={m.id} className="space-y-1.5">
              <Link
                href={`/reunioes/${m.id}`}
                className="press-feedback group block paper-card rounded-2xl border border-[color:var(--border)] hover:border-[color:var(--muted)] p-4 sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-[color:var(--accent)] flex items-center justify-center">
                    <MeetingIcon type={m.meeting_type} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="flex-1 text-[15px] leading-snug text-[color:var(--foreground)] line-clamp-2">
                        {m.summary || "Reunião sem resumo"}
                      </p>
                      <StatusPill status={m.status} />
                    </div>
                    <div className="mt-2 flex items-center flex-wrap gap-x-3 gap-y-1 text-[12px] text-[color:var(--muted)]">
                      {m.recorded_at && <span>{fmtDate(m.recorded_at)}</span>}
                      {m.duration_seconds && m.duration_seconds > 0 ? (
                        <span>· {Math.max(1, Math.round(m.duration_seconds / 60))} min</span>
                      ) : null}
                      {m.n_tarefas > 0 && (
                        <span className="text-[color:var(--muted-strong)]">
                          · <span className="font-medium text-[color:var(--foreground)]">{m.n_tarefas}</span>{" "}
                          {m.n_tarefas === 1 ? "ação" : "ações"}
                          {m.n_minhas > 0 && (
                            <span className="text-[color:var(--muted)]">
                              {" "}
                              (
                              <span className="text-[color:var(--foreground)] font-medium">
                                {m.n_minhas}
                              </span>{" "}
                              minhas)
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 self-center text-[color:var(--muted)] group-hover:text-[color:var(--foreground)] transition">
                    <ChevronRight size={18} strokeWidth={1.75} />
                  </div>
                </div>
              </Link>
              {m.needs_segmentation && (
                <Link
                  href={`/reunioes/${m.id}/segmentar`}
                  className="ml-11 inline-flex items-center gap-1.5 text-[11px] text-[color:var(--warm)] bg-[color:var(--warm-bg)] px-2.5 py-1 rounded-full hover:opacity-80 transition w-fit"
                >
                  ⚠️ áudio longo · revisar segmentação
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

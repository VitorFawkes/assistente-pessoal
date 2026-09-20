import type { Competency, Evidence } from "@/lib/coach/types";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { fmtClock } from "@/lib/transcript-format";

export const fieldClass = "w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--calm)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50";
export const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--calm)] disabled:opacity-45 disabled:cursor-not-allowed";
export const primaryClass = `${buttonClass} !border-transparent bg-foreground text-background hover:!bg-[var(--muted-strong)]`;
export type CoachMutation = (payload: Record<string, unknown>, successMessage?: string) => Promise<boolean>;

export const competencies: Record<Competency, string> = {
  focus: "Foco e priorização",
  judgment: "Julgamento e decisões",
  communication: "Comunicação e escuta",
  delegation: "Delegação e desenvolvimento",
  commitments: "Compromissos e execução",
  self_awareness: "Autoconhecimento e aprendizagem",
};

export function dateLabel(value: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "Data não registrada";
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return "Data não registrada";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "short", year: "numeric", ...options }).format(date);
}

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return (
    <details className="group mt-4 border-t border-border pt-3">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-strong outline-none focus-visible:ring-2 focus-visible:ring-[var(--calm)] rounded">
        <BookOpen size={15} aria-hidden="true" />
        Ver {evidence.length === 1 ? "a evidência" : `as ${evidence.length} evidências`}
        <span className="ml-auto text-xs group-open:hidden">Abrir</span>
      </summary>
      <div className="space-y-4 pb-1 pt-3">
        {evidence.map((item, index) => {
          const params = new URLSearchParams({ meeting: item.meeting_id, chunk: String(item.chunk_index), hash: item.source_hash });
          return (
            <div key={`${item.meeting_id}-${item.chunk_index}-${index}`} className="border-l-2 border-[var(--calm)] pl-3">
              <blockquote className="whitespace-pre-wrap break-words text-sm leading-relaxed">“{item.quote}”</blockquote>
              <a href={`/coach/evidence?${params.toString()}`} className="mt-2 inline-flex min-h-9 max-w-full items-center gap-1.5 text-xs font-medium text-[var(--calm)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">
                <span className="break-words">{item.meeting_title || "Abrir reunião"}</span>
                <ArrowUpRight size={13} className="shrink-0" aria-hidden="true" />
              </a>
              <p className="mt-0.5 text-xs text-muted-strong">{dateLabel(item.recorded_at)}{typeof item.start === "number" ? ` · ${fmtClock(item.start)}` : ""}{item.speaker ? ` · ${item.speaker}` : ""}</p>
              {!item.self_attributed && <p className="mt-1 text-xs leading-relaxed text-muted-strong">Este trecho não está confirmado como uma fala sua. Ele oferece contexto sobre a reunião.</p>}
            </div>
          );
        })}
      </div>
    </details>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Music } from "lucide-react";

export type VoiceSample = {
  id: string;
  source_meeting_id: string | null;
  source_speaker_letter: string | null;
  source_segment_range: string | null;
  duration_seconds: number | null;
  created_at: string;
  meeting_summary: string | null;
  meeting_recorded_at: string | null;
};

function parseRange(range: string | null): [number, number] | null {
  if (!range) return null;
  const m = range.match(/^([0-9.]+)-([0-9.]+)$/);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2])];
}

function fmtTimecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtDateBR(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PessoaSamplesList({ samples }: { samples: VoiceSample[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (sampleId: string, hint: string) => {
    if (!confirm(`Deletar amostra ${hint}? Não dá pra desfazer (soft delete — mas não some da UI).`)) {
      return;
    }
    setError(null);
    setDeletingId(sampleId);
    try {
      const res = await fetch(`/api/samples/${sampleId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  if (samples.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center">
        <p className="text-sm text-[color:var(--muted)]">
          Nenhuma amostra de voz ainda. Rotule speakers em reuniões pra começar
          a popular a base.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
          {error}
        </div>
      )}
      {samples.map((s) => {
        const range = parseRange(s.source_segment_range);
        const canPlay = range && s.source_meeting_id;
        const audioSrc = canPlay
          ? `/api/audio/${s.source_meeting_id}#t=${range[0]},${range[1]}`
          : null;
        const rangeLabel = range
          ? `${fmtTimecode(range[0])} → ${fmtTimecode(range[1])}`
          : "?";

        return (
          <div
            key={s.id}
            className="paper-card rounded-2xl border border-[color:var(--border)] p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 rounded-full bg-[color:var(--calm-bg)] flex items-center justify-center text-[color:var(--calm)]">
                <Music size={16} strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-[12px] text-[color:var(--muted-strong)]">
                  <span className="font-mono">{rangeLabel}</span>
                  {s.duration_seconds != null && (
                    <>
                      <span>·</span>
                      <span>{Math.round(s.duration_seconds)}s</span>
                    </>
                  )}
                  {s.source_speaker_letter && (
                    <>
                      <span>·</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-[color:var(--accent)]">
                        Speaker {s.source_speaker_letter}
                      </span>
                    </>
                  )}
                </div>
                {s.source_meeting_id && (
                  <Link
                    href={`/reunioes/${s.source_meeting_id}`}
                    className="block mt-1 text-[14px] text-[color:var(--foreground)] hover:underline line-clamp-1"
                  >
                    {s.meeting_summary || "reunião sem resumo"}
                  </Link>
                )}
                <p className="text-[11px] text-[color:var(--muted)] mt-0.5">
                  enrolada em {fmtDateBR(s.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(s.id, rangeLabel)}
                disabled={deletingId === s.id || isPending}
                className="shrink-0 p-2 rounded-full text-[color:var(--muted)] hover:bg-[color:var(--urgent-bg)] hover:text-[color:var(--urgent)] disabled:opacity-50"
                title="Deletar essa amostra (não é a pessoa certa)"
                aria-label="deletar amostra"
              >
                <Trash2 size={15} />
              </button>
            </div>
            {audioSrc && (
              <audio controls preload="none" src={audioSrc} className="w-full" />
            )}
          </div>
        );
      })}
    </div>
  );
}

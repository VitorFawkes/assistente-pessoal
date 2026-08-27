"use client";

import { dataHoraBR } from "@/lib/data-br";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Music, ArrowRightLeft, Check, X } from "lucide-react";
import { meetingLabel } from "@/lib/meeting-label";

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

export type PessoaOption = { id: string; nome: string };

const REASSIGN_DATALIST_ID = "reassign-pessoas-options";

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
  return dataHoraBR(d);
}

export function PessoaSamplesList({
  samples,
  currentPessoaId,
  pessoas,
}: {
  samples: VoiceSample[];
  currentPessoaId: string;
  pessoas: PessoaOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [reassignValue, setReassignValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [movedTo, setMovedTo] = useState<{
    nome: string;
    pessoa_id: string;
    meetingSpeakerUpdated: boolean;
  } | null>(null);

  const handleDelete = async (sampleId: string, hint: string) => {
    if (!confirm(`Deletar amostra ${hint}?`)) return;
    setError(null);
    setBusyId(sampleId);
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
      setBusyId(null);
    }
  };

  const handleReassign = async (sampleId: string, nome: string) => {
    const trimmed = nome.trim();
    if (!trimmed) return;
    setError(null);
    setBusyId(sampleId);
    try {
      const res = await fetch(`/api/samples/${sampleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      setReassigningId(null);
      setReassignValue("");
      // Se o backend reportou que o speaker da meeting agora reflete a nova pessoa,
      // o mapeamento da reunião foi atualizado também (não só a amostra individual).
      const speakerNow = body.meeting_speaker_now;
      setMovedTo({
        nome: body.nome || trimmed,
        pessoa_id: body.pessoa_id,
        meetingSpeakerUpdated:
          speakerNow != null && speakerNow.pessoa_id === body.pessoa_id,
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (samples.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center">
        <p className="text-sm text-[color:var(--muted)]">
          Nenhuma amostra ativa pra essa pessoa. Rotule speakers em reuniões pra
          começar a popular a base.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <datalist id={REASSIGN_DATALIST_ID}>
        {pessoas
          .filter((p) => p.id !== currentPessoaId)
          .map((p) => (
            <option key={p.id} value={p.nome} />
          ))}
      </datalist>

      {error && (
        <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
          {error}
        </div>
      )}
      {movedTo && (
        <div className="flex items-start justify-between gap-3 text-[12px] text-[color:var(--calm)] bg-[color:var(--calm-bg)] px-3 py-2 rounded-lg">
          <div className="flex-1 min-w-0">
            <p>
              ✓ amostra movida pra <strong>{movedTo.nome}</strong>
            </p>
            {movedTo.meetingSpeakerUpdated && (
              <p className="text-[11px] opacity-80 mt-0.5">
                o speaker dessa reunião agora reflete {movedTo.nome} (maioria das
                amostras)
              </p>
            )}
          </div>
          <Link
            href={`/pessoas/${movedTo.pessoa_id}`}
            className="underline font-medium hover:opacity-80 shrink-0"
          >
            ver lá →
          </Link>
        </div>
      )}
      {samples.map((s) => {
        const range = parseRange(s.source_segment_range);
        const canPlay = range && s.source_meeting_id;
        // Player vê só o trecho cortado (não a reunião inteira) — voice-svc/clip via ffmpeg
        const audioSrc = canPlay
          ? `/api/voice-svc/clip?meeting_id=${s.source_meeting_id}&start=${range[0]}&end=${range[1]}`
          : null;
        const rangeLabel = range
          ? `${fmtTimecode(range[0])} → ${fmtTimecode(range[1])}`
          : "?";
        const isReassigning = reassigningId === s.id;
        const isBusy = busyId === s.id || isPending;

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
                        Voz {s.source_speaker_letter}
                      </span>
                    </>
                  )}
                </div>
                {s.source_meeting_id && (
                  <Link
                    href={`/reunioes/${s.source_meeting_id}`}
                    className="block mt-1 text-[14px] text-[color:var(--foreground)] hover:underline line-clamp-1"
                  >
                    {meetingLabel(s.meeting_summary, s.meeting_recorded_at) ||
                      "reunião sem resumo"}
                  </Link>
                )}
                <p className="text-[11px] text-[color:var(--muted)] mt-0.5">
                  adicionada em {fmtDateBR(s.created_at)}
                </p>
              </div>
              {!isReassigning && (
                <div className="shrink-0 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setReassigningId(s.id);
                      setReassignValue("");
                      setError(null);
                    }}
                    disabled={isBusy}
                    className="p-2 rounded-full text-[color:var(--muted)] hover:bg-[color:var(--accent)] hover:text-[color:var(--foreground)] disabled:opacity-50"
                    title="Não é essa pessoa — mover pra outra"
                    aria-label="reatribuir amostra"
                  >
                    <ArrowRightLeft size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id, rangeLabel)}
                    disabled={isBusy}
                    className="p-2 rounded-full text-[color:var(--muted)] hover:bg-[color:var(--urgent-bg)] hover:text-[color:var(--urgent)] disabled:opacity-50"
                    title="Deletar amostra (descartar)"
                    aria-label="deletar amostra"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>

            {audioSrc && (
              <audio controls preload="none" src={audioSrc} className="w-full" />
            )}

            {isReassigning && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[color:var(--border)]/50">
                <span className="text-[12px] text-[color:var(--muted-strong)]">
                  Mover pra:
                </span>
                <input
                  type="text"
                  autoFocus
                  list={REASSIGN_DATALIST_ID}
                  value={reassignValue}
                  onChange={(e) => setReassignValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleReassign(s.id, reassignValue);
                    if (e.key === "Escape") {
                      setReassigningId(null);
                      setReassignValue("");
                    }
                  }}
                  placeholder="nome (existente ou novo)"
                  className="flex-1 min-w-[140px] text-[13px] px-2 py-1 rounded-lg bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
                  disabled={isBusy}
                />
                <button
                  type="button"
                  onClick={() => handleReassign(s.id, reassignValue)}
                  disabled={isBusy || !reassignValue.trim()}
                  className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
                >
                  <Check size={12} /> mover
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReassigningId(null);
                    setReassignValue("");
                  }}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-full text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]"
                >
                  <X size={12} /> cancelar
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

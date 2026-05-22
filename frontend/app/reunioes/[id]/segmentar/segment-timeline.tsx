"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, X, Plus, Archive } from "lucide-react";
import type { Cut, Segment } from "@/lib/detect-cuts";
import { DETECT_CONSTANTS } from "@/lib/detect-cuts";
import { cn } from "@/lib/utils";

function fmtTime(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtDurShort(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}`;
  return `${m}min`;
}

function parseTime(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (min >= 60 || sec >= 60) return null;
  return h * 3600 + min * 60 + sec;
}

type EditableCut = {
  at_seconds: number;
  title: string;
  reasons: string[];
  confidence: number;
};

export function SegmentTimeline({
  meetingId,
  initialCuts,
  duration,
  segments,
  archiveOnly,
}: {
  meetingId: string;
  initialCuts: Cut[];
  duration: number;
  segments: Segment[];
  recordedAt: string | null;
  archiveOnly?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cuts, setCuts] = useState<EditableCut[]>(() =>
    initialCuts.map((c) => ({
      at_seconds: c.at_seconds,
      title: "",
      reasons: c.reasons,
      confidence: c.confidence,
    })),
  );
  const [newCutInput, setNewCutInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const positions = useMemo(
    () => [0, ...cuts.map((c) => c.at_seconds), duration],
    [cuts, duration],
  );

  const intervals = useMemo(
    () =>
      positions.slice(0, -1).map((p, i) => ({
        start: p,
        end: positions[i + 1],
        durationSeconds: positions[i + 1] - p,
        speakers: Array.from(
          new Set(
            segments
              .filter((s) => s.start >= p && s.end <= positions[i + 1])
              .map((s) => s.speaker),
          ),
        ).sort(),
        firstPhrase:
          segments
            .filter(
              (s) => s.start >= p && s.end <= positions[i + 1] && s.end - s.start >= 3,
            )
            .slice(0, 1)
            .map((s) => s.text.trim().slice(0, 140))[0] || "",
      })),
    [positions, segments],
  );

  const intervalErrors = useMemo(() => {
    const errs: string[] = [];
    for (let i = 0; i < intervals.length; i++) {
      if (intervals[i].durationSeconds < DETECT_CONSTANTS.MIN_SEGMENT_DURATION) {
        errs.push(
          `segmento ${i + 1} tem ${fmtDurShort(intervals[i].durationSeconds)} (mín. ${DETECT_CONSTANTS.MIN_SEGMENT_DURATION / 60}min)`,
        );
      }
    }
    return errs;
  }, [intervals]);

  function moveCut(idx: number, newAt: number) {
    setCuts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], at_seconds: newAt };
      next.sort((a, b) => a.at_seconds - b.at_seconds);
      return next;
    });
  }

  function removeCut(idx: number) {
    setCuts((prev) => prev.filter((_, i) => i !== idx));
  }

  function addCut() {
    const sec = parseTime(newCutInput);
    if (sec === null || sec <= 0 || sec >= duration) {
      setError("formato inválido — use HH:MM:SS dentro da duração do áudio");
      return;
    }
    setError(null);
    setNewCutInput("");
    setCuts((prev) => {
      const next = [
        ...prev,
        { at_seconds: sec, title: "", reasons: ["manual"], confidence: 1 },
      ];
      next.sort((a, b) => a.at_seconds - b.at_seconds);
      return next;
    });
  }

  async function submitSegments() {
    if (intervalErrors.length > 0) {
      setError(intervalErrors.join("; "));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cuts: cuts.map((c) => ({ at_seconds: c.at_seconds, title: c.title || null })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      startTransition(() => router.push("/reunioes?segmented=1"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function archiveOnlyAction() {
    if (!confirmArchive) {
      setConfirmArchive(true);
      setTimeout(() => setConfirmArchive(false), 5000);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive_only: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      startTransition(() => router.push("/reunioes"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function markSingleAction() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_single: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      startTransition(() => router.push(`/reunioes/${meetingId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (archiveOnly) {
    return (
      <div className="mt-6 space-y-3">
        {error && (
          <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
            {error}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={markSingleAction}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
          >
            {busy ? <Sparkles size={12} className="animate-pulse" /> : <Check size={12} />}
            é uma reunião só, manter
          </button>
          <button
            type="button"
            onClick={archiveOnlyAction}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--card)] border border-[color:var(--border)] text-[color:var(--muted-strong)] hover:opacity-80 disabled:opacity-50"
          >
            <Archive size={12} />
            {confirmArchive ? "clique de novo pra confirmar" : "arquivar sem segmentar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="paper-card rounded-2xl border border-[color:var(--border)] p-4 sm:p-5">
        <audio
          controls
          preload="metadata"
          src={`/api/audio/${meetingId}`}
          className="w-full"
        />
        <p className="text-[12px] text-[color:var(--muted)] mt-2">
          {fmtDurShort(duration)} total · {cuts.length} cortes propostos ·{" "}
          {intervals.length} segmentos
        </p>
      </div>

      {error && (
        <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {intervals.map((iv, i) => (
          <div key={`iv-${i}`}>
            <div className="paper-card rounded-2xl border border-[color:var(--border)] p-4 sm:p-5 space-y-2">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
                  Segmento {i + 1} · {fmtTime(iv.start)}–{fmtTime(iv.end)} (
                  {fmtDurShort(iv.durationSeconds)})
                </p>
              </div>
              <p className="text-[12px] text-[color:var(--muted-strong)]">
                Speakers: {iv.speakers.join(", ") || "—"}
              </p>
              {iv.firstPhrase && (
                <p className="text-[12px] text-[color:var(--muted-strong)] italic line-clamp-2">
                  &ldquo;{iv.firstPhrase}…&rdquo;
                </p>
              )}
              {i < cuts.length && (
                <div className="pt-2">
                  <input
                    type="text"
                    value={cuts[i].title}
                    onChange={(e) =>
                      setCuts((prev) => {
                        const next = [...prev];
                        next[i] = { ...next[i], title: e.target.value };
                        return next;
                      })
                    }
                    placeholder="título opcional do próximo segmento…"
                    className="w-full text-[13px] px-3 py-1.5 rounded-full bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
                  />
                </div>
              )}
            </div>

            {i < cuts.length && (
              <CutRow
                cut={cuts[i]}
                idx={i}
                duration={duration}
                prevPos={positions[i]}
                nextPos={positions[i + 2]}
                onMove={moveCut}
                onRemove={removeCut}
              />
            )}
          </div>
        ))}
      </div>

      <div className="paper-card rounded-2xl border border-dashed border-[color:var(--border)] p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={newCutInput}
            onChange={(e) => setNewCutInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCut();
            }}
            placeholder="HH:MM:SS"
            className="flex-1 min-w-[140px] text-[13px] px-3 py-1.5 rounded-full bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
          />
          <button
            type="button"
            onClick={addCut}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:opacity-80 disabled:opacity-50"
          >
            <Plus size={12} /> adicionar corte
          </button>
        </div>
      </div>

      {intervalErrors.length > 0 && (
        <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
          {intervalErrors.join(" · ")}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-[color:var(--border)]/50">
        <button
          type="button"
          onClick={submitSegments}
          disabled={busy || intervalErrors.length > 0}
          className="inline-flex items-center gap-1 text-[13px] px-4 py-2 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
        >
          {busy ? <Sparkles size={12} className="animate-pulse" /> : <Check size={12} />}
          confirmar e criar {intervals.length} reuniões
        </button>
        <button
          type="button"
          onClick={markSingleAction}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:opacity-80 disabled:opacity-50"
        >
          <Check size={12} />
          é uma reunião só, manter
        </button>
        <button
          type="button"
          onClick={archiveOnlyAction}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--card)] border border-[color:var(--border)] text-[color:var(--muted-strong)] hover:opacity-80 disabled:opacity-50"
        >
          <Archive size={12} />
          {confirmArchive ? "clique de novo pra confirmar" : "arquivar sem segmentar"}
        </button>
      </div>
    </div>
  );
}

function CutRow({
  cut,
  idx,
  duration,
  prevPos,
  nextPos,
  onMove,
  onRemove,
}: {
  cut: EditableCut;
  idx: number;
  duration: number;
  prevPos: number;
  nextPos: number;
  onMove: (idx: number, newAt: number) => void;
  onRemove: (idx: number) => void;
}) {
  const [draft, setDraft] = useState<string>(fmtTime(cut.at_seconds));
  const [localErr, setLocalErr] = useState<string | null>(null);

  function commit() {
    const sec = parseTime(draft);
    if (sec === null) {
      setLocalErr("HH:MM:SS inválido");
      return;
    }
    const minAt = prevPos + DETECT_CONSTANTS.MIN_SEGMENT_DURATION;
    const maxAt = nextPos - DETECT_CONSTANTS.MIN_SEGMENT_DURATION;
    if (sec < minAt || sec > maxAt) {
      setLocalErr(`fora do intervalo permitido (${fmtTime(minAt)}–${fmtTime(maxAt)})`);
      return;
    }
    if (sec <= 0 || sec >= duration) {
      setLocalErr("fora da duração do áudio");
      return;
    }
    setLocalErr(null);
    onMove(idx, sec);
  }

  return (
    <div className="my-2 mx-3 px-3 py-2 rounded-xl bg-[color:var(--accent)]/30 border border-dashed border-[color:var(--border)]">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="font-mono text-[color:var(--muted-strong)]">✂️ corte</span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={cn(
            "font-mono text-[11px] px-2 py-0.5 rounded bg-[color:var(--card)] border outline-none w-[110px]",
            localErr
              ? "border-[color:var(--urgent)]"
              : "border-[color:var(--border)] focus:border-[color:var(--foreground)]",
          )}
        />
        <span className="text-[color:var(--muted)]">·</span>
        <span className="text-[color:var(--muted)]">{cut.reasons.join(" + ")}</span>
        <button
          type="button"
          onClick={() => onRemove(idx)}
          className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--urgent-bg)] text-[color:var(--urgent)] hover:opacity-80"
        >
          <X size={10} /> remover
        </button>
      </div>
      {localErr && (
        <p className="text-[10px] text-[color:var(--urgent)] mt-1">{localErr}</p>
      )}
    </div>
  );
}

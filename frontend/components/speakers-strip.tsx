"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Sparkles, UserRound, X } from "lucide-react";
import type { SpeakerCard, Turn } from "@/components/identify-speakers";
import type { ProposedLabel } from "@/components/transcription-view";
import { cn } from "@/lib/utils";

const SELF_NAME = "Vitor";
const DATALIST_ID = "speakers-strip-pessoas-options";

function fmtTimecode(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function speakerColor(letter: string): { bg: string; text: string } {
  const palette = [
    { bg: "bg-[color:var(--calm-bg)]", text: "text-[color:var(--calm)]" },
    { bg: "bg-[color:var(--warm-bg)]", text: "text-[color:var(--warm)]" },
    { bg: "bg-[color:var(--accent)]", text: "text-[color:var(--muted-strong)]" },
    { bg: "bg-[color:var(--urgent-bg)]", text: "text-[color:var(--urgent)]" },
    { bg: "bg-[color:var(--calm-bg)]/60", text: "text-[color:var(--calm)]" },
    { bg: "bg-[color:var(--warm-bg)]/60", text: "text-[color:var(--warm)]" },
  ];
  const idx = letter.charCodeAt(0) - "A".charCodeAt(0);
  return palette[((idx % palette.length) + palette.length) % palette.length];
}

export function SpeakersStrip({
  meetingId,
  speakers,
  pessoas,
  speakerLabelsProposed,
}: {
  meetingId: string;
  speakers: SpeakerCard[];
  pessoas: Array<{ id: string; nome: string }>;
  speakerLabelsProposed?: Record<string, ProposedLabel | null>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const initialLabels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of speakers) {
      if (s.current_label) m[s.letter] = s.current_label;
    }
    return m;
  }, [speakers]);

  const [labels, setLabels] = useState(initialLabels);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [excludedTurns, setExcludedTurns] = useState<Set<string>>(new Set());
  const [busyLetter, setBusyLetter] = useState<string | null>(null);
  const [savedMessages, setSavedMessages] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const turnKey = (letter: string, t: Turn) => `${letter}|${t.start}-${t.end}`;

  const toggleTurn = (letter: string, t: Turn) => {
    const k = turnKey(letter, t);
    setExcludedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  async function saveOne(letter: string, nome: string, speaker: SpeakerCard) {
    const trimmed = nome.trim();
    if (!trimmed) return;
    setError(null);
    setBusyLetter(letter);
    try {
      const nextLabels = { ...labels, [letter]: trimmed };
      const included = speaker.top_turns.filter(
        (t) => !excludedTurns.has(turnKey(letter, t)),
      );
      const turnsByLetter: Record<string, Array<{ start: number; end: number }>> = {};
      if (included.length > 0 && included.length < speaker.top_turns.length) {
        turnsByLetter[letter] = included.map((t) => ({ start: t.start, end: t.end }));
      }
      const res = await fetch(`/api/meetings/${meetingId}/speakers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labels: nextLabels,
          ...(Object.keys(turnsByLetter).length > 0 ? { turns_by_letter: turnsByLetter } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      setLabels(nextLabels);
      setDrafts((d) => ({ ...d, [letter]: "" }));
      const nTotal = speaker.top_turns.length;
      const nIncluded = included.length;
      const msg =
        nIncluded < nTotal
          ? `✓ ${trimmed} (${nIncluded}/${nTotal} trechos)`
          : `✓ ${trimmed}`;
      setSavedMessages((m) => ({ ...m, [letter]: msg }));
      setTimeout(() => {
        setSavedMessages((m) => {
          const n = { ...m };
          delete n[letter];
          return n;
        });
      }, 6000);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLetter(null);
    }
  }

  if (speakers.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Quem falou ({speakers.length})
        </h2>
        <p className="text-[11px] text-[color:var(--muted)]">
          Clique pra escutar e identificar
        </p>
      </div>

      <datalist id={DATALIST_ID}>
        {pessoas.map((p) => (
          <option key={p.id} value={p.nome} />
        ))}
      </datalist>

      {error && (
        <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {speakers.map((s) => {
          const isOpen = expanded === s.letter;
          const labeled = labels[s.letter];
          const color = speakerColor(s.letter);
          const isSelf = (labeled || "").toLowerCase() === SELF_NAME.toLowerCase();
          const proposal = speakerLabelsProposed?.[s.letter];
          const firstTurn = s.top_turns[0];
          const savedMsg = savedMessages[s.letter];

          const toggle = () => setExpanded(isOpen ? null : s.letter);
          return (
            <div
              key={s.letter}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle();
                }
              }}
              className={cn(
                "paper-card rounded-2xl border p-3 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--foreground)]/30",
                isOpen && "ring-2 ring-[color:var(--foreground)]/20",
                labeled
                  ? "border-[color:var(--calm)]/40 bg-[color:var(--calm-bg)]/20"
                  : "border-[color:var(--border)]",
              )}
            >
              <div className="w-full flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[11px] tracking-wide font-medium px-2 py-0.5 rounded-full shrink-0",
                    isSelf
                      ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                      : `${color.bg} ${color.text}`,
                  )}
                >
                  {isSelf && <UserRound size={10} />}
                  {labeled || `Voz ${s.letter}`}
                </span>
                <span className="text-[10px] text-[color:var(--muted)] flex-1 text-left truncate">
                  {/* segundos crus não dizem nada: 1794s vira "30 min" */}
                  {s.total_seconds >= 60
                    ? `${Math.round(s.total_seconds / 60)} min`
                    : `${Math.round(s.total_seconds)}s`}{" "}
                  · {s.total_turns} {s.total_turns === 1 ? "fala" : "falas"}
                </span>
                <ChevronDown
                  size={13}
                  className={cn(
                    "text-[color:var(--muted)] shrink-0 transition-transform",
                    isOpen ? "rotate-180" : "",
                  )}
                />
              </div>

              {/* Status row — texto explícito em vez de só ícone */}
              {!isOpen && (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  {labeled ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[color:var(--calm)] font-medium">
                      <Check size={11} /> confirmado
                    </span>
                  ) : proposal ? (
                    <>
                      <span className="text-[10px] text-[color:var(--muted)]">
                        voice-svc sugere
                      </span>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          saveOne(s.letter, proposal.nome, s);
                        }}
                        disabled={busyLetter === s.letter}
                        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] border border-[color:var(--warm)]/40 hover:opacity-90 disabled:opacity-50 font-medium"
                      >
                        {busyLetter === s.letter ? (
                          <Sparkles size={9} className="animate-pulse" />
                        ) : (
                          <Check size={9} />
                        )}
                        confirmar &ldquo;{proposal.nome}&rdquo;
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] text-[color:var(--muted)]">
                      sem nome — clique pra identificar
                    </span>
                  )}
                </div>
              )}

              {savedMsg && !isOpen && (
                <p className="text-[11px] text-[color:var(--calm)] mt-2">{savedMsg}</p>
              )}

              {isOpen && (
                <div
                  className="mt-3 space-y-3 pt-3 border-t border-[color:var(--border)]/50"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {savedMsg && (
                    <p className="text-[12px] text-[color:var(--calm)] bg-[color:var(--calm-bg)] px-3 py-1.5 rounded-lg">
                      {savedMsg}
                    </p>
                  )}

                  {!labeled && proposal && (
                    <button
                      type="button"
                      onClick={() => saveOne(s.letter, proposal.nome, s)}
                      disabled={busyLetter === s.letter}
                      className="w-full text-left text-[12px] px-3 py-2 rounded-xl bg-[color:var(--warm-bg)] hover:opacity-90 border border-[color:var(--warm)]/30 disabled:opacity-50"
                    >
                      <span className="text-[color:var(--warm)] font-medium">
                        ✨ aceitar &ldquo;{proposal.nome}&rdquo;
                      </span>
                      <span className="text-[10px] text-[color:var(--muted)] ml-2">
                        {Math.round(proposal.confidence * 100)}% confidence
                      </span>
                    </button>
                  )}

                  <div className="space-y-2">
                    {s.top_turns.map((t, i) => {
                      const k = turnKey(s.letter, t);
                      const excluded = excludedTurns.has(k);
                      return (
                        <div
                          key={i}
                          className={cn(
                            "space-y-1 p-2 rounded-lg transition",
                            excluded
                              ? "bg-[color:var(--urgent-bg)]/30 opacity-60"
                              : "bg-[color:var(--card)]/50",
                          )}
                        >
                          <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--muted)] font-mono">
                            <span>
                              {fmtTimecode(t.start)} → {fmtTimecode(t.end)} ·{" "}
                              {Math.round(t.end - t.start)}s
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleTurn(s.letter, t)}
                              className={cn(
                                "ml-auto inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full normal-case tracking-normal transition",
                                excluded
                                  ? "bg-[color:var(--urgent)] text-[color:var(--background)]"
                                  : "bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:opacity-80",
                              )}
                            >
                              {excluded ? (
                                <>
                                  <X size={9} /> não é
                                </>
                              ) : (
                                <>
                                  <Check size={9} /> é
                                </>
                              )}
                            </button>
                          </div>
                          <audio
                            controls
                            preload="none"
                            src={`/api/voice-svc/clip?meeting_id=${meetingId}&start=${t.start}&end=${Math.min(t.end, t.start + 30)}`}
                            className="w-full"
                            style={{ height: 28 }}
                          />
                          {t.text && (
                            <p className="text-[10px] text-[color:var(--muted-strong)] line-clamp-1 italic">
                              &ldquo;{t.text.trim()}&rdquo;
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[color:var(--border)]/50">
                    <input
                      type="text"
                      list={DATALIST_ID}
                      value={drafts[s.letter] || ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [s.letter]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveOne(s.letter, drafts[s.letter] || labeled || "", s);
                      }}
                      placeholder={labeled ? `mudar de ${labeled}…` : "quem é?"}
                      className="flex-1 min-w-[120px] text-[12px] px-2.5 py-1 rounded-full bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
                      disabled={busyLetter === s.letter}
                    />
                    <button
                      type="button"
                      onClick={() => saveOne(s.letter, SELF_NAME, s)}
                      disabled={busyLetter === s.letter}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:opacity-80 disabled:opacity-50"
                      title="Marcar como Vitor"
                    >
                      <UserRound size={10} /> sou eu
                    </button>
                    <button
                      type="button"
                      onClick={() => saveOne(s.letter, drafts[s.letter] || labeled || "", s)}
                      disabled={
                        busyLetter === s.letter ||
                        (!(drafts[s.letter] || "").trim() && !labeled)
                      }
                      className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
                    >
                      {busyLetter === s.letter ? (
                        <Sparkles size={10} className="animate-pulse" />
                      ) : (
                        <Check size={10} />
                      )}
                      {labeled ? "atualizar" : "salvar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

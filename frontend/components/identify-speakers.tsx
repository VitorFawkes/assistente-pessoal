"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, UserRound, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const SELF_NAME = "Vitor";
const DATALIST_ID = "identify-pessoas-options";

export type Turn = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

export type SpeakerCard = {
  letter: string;
  total_seconds: number;
  total_turns: number;
  current_label: string | null;
  top_turns: Turn[];
};

function fmtTimecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
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

export function IdentifySpeakers({
  meetingId,
  speakers,
  pessoas,
}: {
  meetingId: string;
  speakers: SpeakerCard[];
  pessoas: Array<{ id: string; nome: string }>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [labels, setLabels] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of speakers) {
      if (s.current_label) init[s.letter] = s.current_label;
    }
    return init;
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [busyLetter, setBusyLetter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveOne = async (letter: string, nome: string) => {
    const trimmed = nome.trim();
    if (!trimmed) return;
    setError(null);
    setBusyLetter(letter);
    try {
      // Patch só com a letter desse speaker, mas backend espera mapping completo.
      // Estratégia: mandar TODO o mapping atual (labels existentes) + a nova letter.
      const nextLabels = { ...labels, [letter]: trimmed };
      const res = await fetch(`/api/meetings/${meetingId}/speakers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: nextLabels }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      setLabels(nextLabels);
      setValues((v) => ({ ...v, [letter]: "" }));
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLetter(null);
    }
  };

  const naoRotulados = speakers.filter((s) => !labels[s.letter]);
  const rotulados = speakers.filter((s) => !!labels[s.letter]);

  if (speakers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center">
        <p className="text-sm text-[color:var(--muted)]">
          Sem speakers com trechos longos o suficiente (≥ 3s).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      {naoRotulados.length === 0 && (
        <div className="text-[13px] text-[color:var(--calm)] bg-[color:var(--calm-bg)] px-4 py-3 rounded-2xl">
          ✓ todos os speakers rotulados nessa reunião.
        </div>
      )}

      {naoRotulados.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
            Pra rotular ({naoRotulados.length})
          </h2>
          {naoRotulados.map((s) => (
            <SpeakerRow
              key={s.letter}
              meetingId={meetingId}
              speaker={s}
              value={values[s.letter] || ""}
              onValueChange={(v) => setValues((vs) => ({ ...vs, [s.letter]: v }))}
              onSave={(n) => saveOne(s.letter, n)}
              saving={busyLetter === s.letter}
            />
          ))}
        </section>
      )}

      {rotulados.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
            Já rotulados ({rotulados.length})
          </h2>
          {rotulados.map((s) => (
            <SpeakerRow
              key={s.letter}
              meetingId={meetingId}
              speaker={s}
              value={values[s.letter] || ""}
              onValueChange={(v) => setValues((vs) => ({ ...vs, [s.letter]: v }))}
              onSave={(n) => saveOne(s.letter, n)}
              saving={busyLetter === s.letter}
              currentName={labels[s.letter]}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function SpeakerRow({
  meetingId,
  speaker,
  value,
  onValueChange,
  onSave,
  saving,
  currentName,
}: {
  meetingId: string;
  speaker: SpeakerCard;
  value: string;
  onValueChange: (v: string) => void;
  onSave: (nome: string) => void;
  saving: boolean;
  currentName?: string;
}) {
  const color = speakerColor(speaker.letter);
  const isSelf = (currentName || "").toLowerCase() === SELF_NAME.toLowerCase();

  return (
    <div className="paper-card rounded-2xl border border-[color:var(--border)] p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] tracking-wide font-medium px-2.5 py-1 rounded-full",
            isSelf
              ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
              : `${color.bg} ${color.text}`,
          )}
        >
          {isSelf && <UserRound size={11} />}
          {currentName ? `${currentName}` : `Speaker ${speaker.letter}`}
        </span>
        <span className="text-[12px] text-[color:var(--muted)]">
          {speaker.total_turns} {speaker.total_turns === 1 ? "fala" : "falas"} · {Math.round(speaker.total_seconds)}s de áudio total
        </span>
      </div>

      <div className="space-y-2">
        {speaker.top_turns.map((t, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] text-[color:var(--muted)] font-mono">
              <span>
                {fmtTimecode(t.start)} → {fmtTimecode(t.end)}
              </span>
              <span>·</span>
              <span>{Math.round(t.end - t.start)}s</span>
            </div>
            <audio
              controls
              preload="none"
              src={`/api/voice-svc/clip?meeting_id=${meetingId}&start=${t.start}&end=${Math.min(t.end, t.start + 30)}`}
              className="w-full"
            />
            {t.text && (
              <p className="text-[12px] text-[color:var(--muted-strong)] line-clamp-2 italic">
                “{t.text.trim()}”
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[color:var(--border)]/50">
        <input
          type="text"
          list={DATALIST_ID}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(value);
          }}
          placeholder={currentName ? `mudar de ${currentName}…` : "quem é?"}
          className="flex-1 min-w-[160px] text-[13px] px-3 py-1.5 rounded-full bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
          disabled={saving}
        />
        <button
          type="button"
          onClick={() => onSave(SELF_NAME)}
          disabled={saving}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:opacity-80 disabled:opacity-50"
          title="Marcar como Vitor (você)"
        >
          <UserRound size={11} /> sou eu
        </button>
        <button
          type="button"
          onClick={() => onSave(value)}
          disabled={saving || !value.trim()}
          className="inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
        >
          {saving ? (
            <Sparkles size={12} className="animate-pulse" />
          ) : (
            <Check size={12} />
          )}
          {currentName ? "atualizar" : "salvar"}
        </button>
      </div>
    </div>
  );
}

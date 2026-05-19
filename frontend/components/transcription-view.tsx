"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

// Nome canônico do dono do sistema (corresponde a pessoas.is_vitor=TRUE).
const SELF_NAME = "Vitor";

export type Segment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

function groupTurns(segments: Segment[]) {
  if (!segments?.length) return [];
  const turns: Array<{ speaker: string; start: number; end: number; text: string }> = [];
  for (const s of segments) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker) {
      last.end = s.end;
      last.text += s.text;
    } else {
      turns.push({ speaker: s.speaker, start: s.start, end: s.end, text: s.text });
    }
  }
  return turns;
}

function speakerStyle(speaker: string): { bg: string; text: string } {
  const palette = [
    { bg: "bg-[color:var(--calm-bg)]", text: "text-[color:var(--calm)]" },
    { bg: "bg-[color:var(--warm-bg)]", text: "text-[color:var(--warm)]" },
    { bg: "bg-[color:var(--accent)]", text: "text-[color:var(--muted-strong)]" },
    { bg: "bg-[color:var(--urgent-bg)]", text: "text-[color:var(--urgent)]" },
    { bg: "bg-[color:var(--calm-bg)]/60", text: "text-[color:var(--calm)]" },
    { bg: "bg-[color:var(--warm-bg)]/60", text: "text-[color:var(--warm)]" },
  ];
  const idx = speaker.charCodeAt(0) - "A".charCodeAt(0);
  return palette[((idx % palette.length) + palette.length) % palette.length];
}

function speakerLabel(speaker: string, labels: Record<string, string>): string {
  return labels[speaker] || `Speaker ${speaker}`;
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const PESSOAS_DATALIST_ID = "speaker-pessoas-options";

function SpeakerChip({
  speaker,
  labels,
  onSave,
  saving,
}: {
  speaker: string;
  labels: Record<string, string>;
  onSave: (speaker: string, newName: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(labels[speaker] || "");
  const style = speakerStyle(speaker);

  const isSelf = (labels[speaker] || "").trim().toLowerCase() === SELF_NAME.toLowerCase();

  if (editing) {
    return (
      <div className="inline-flex flex-wrap items-center gap-1">
        <input
          type="text"
          autoFocus
          list={PESSOAS_DATALIST_ID}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(speaker, value.trim());
              setEditing(false);
            } else if (e.key === "Escape") {
              setEditing(false);
              setValue(labels[speaker] || "");
            }
          }}
          placeholder={`Speaker ${speaker}`}
          className="w-28 text-[11px] px-2 py-0.5 rounded-full bg-[color:var(--card)] border border-[color:var(--foreground)] outline-none"
          disabled={saving}
        />
        <button
          type="button"
          onClick={() => {
            onSave(speaker, SELF_NAME);
            setEditing(false);
          }}
          disabled={saving}
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:opacity-80"
          title={`Marcar como ${SELF_NAME} (você)`}
        >
          <UserRound size={10} />
          Sou eu
        </button>
        <button
          type="button"
          onClick={() => {
            onSave(speaker, value.trim());
            setEditing(false);
          }}
          className="text-[color:var(--calm)]"
          disabled={saving}
          aria-label="salvar"
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue(labels[speaker] || "");
          }}
          className="text-[color:var(--muted)]"
          aria-label="cancelar"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(labels[speaker] || "");
        setEditing(true);
      }}
      className={cn(
        "press-feedback inline-flex items-center gap-1 text-[11px] tracking-wide font-medium px-2 py-0.5 rounded-full",
        isSelf
          ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
          : `${style.bg} ${style.text}`,
        "hover:ring-1 hover:ring-[color:var(--foreground)]/30",
      )}
      title={isSelf ? "Você. Clique para alterar." : "Clique para renomear (vai reprocessar tarefas)"}
    >
      {isSelf && <UserRound size={10} />}
      {speakerLabel(speaker, labels)}
      <Pencil size={9} className="opacity-50" />
    </button>
  );
}

export function TranscriptionView({
  meetingId,
  segments,
  initialLabels,
  pessoas = [],
  fallbackText,
}: {
  meetingId: string;
  segments: Segment[] | null | undefined;
  initialLabels: Record<string, string>;
  pessoas?: Array<{ id: string; nome: string }>;
  fallbackText: string | null;
}) {
  const router = useRouter();
  const [labels, setLabels] = useState<Record<string, string>>(initialLabels || {});
  const [isPending, startTransition] = useTransition();
  const [reprocessing, setReprocessing] = useState(false);

  const handleSave = (speaker: string, newName: string) => {
    const next = { ...labels };
    if (newName) next[speaker] = newName;
    else delete next[speaker];
    setLabels(next);
    setReprocessing(true);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/speakers`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labels: next }),
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        // Espera ~3s pro reprocess do n8n terminar antes de refresh da página
        setTimeout(() => {
          router.refresh();
          setReprocessing(false);
        }, 3000);
      } catch (e) {
        console.error("falha ao salvar labels", e);
        setReprocessing(false);
      }
    });
  };

  if (!segments?.length) {
    if (!fallbackText) return null;
    return (
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[color:var(--foreground)]">
        {fallbackText}
      </p>
    );
  }

  const turns = groupTurns(segments);

  return (
    <div className="space-y-4">
      <datalist id={PESSOAS_DATALIST_ID}>
        {pessoas.map((p) => (
          <option key={p.id} value={p.nome} />
        ))}
      </datalist>
      {reprocessing && (
        <div className="text-[12px] text-[color:var(--muted-strong)] bg-[color:var(--accent)] px-3 py-2 rounded-lg">
          Reprocessando tarefas com os novos nomes…
        </div>
      )}
      {turns.map((t, i) => (
        <div key={i} className="flex gap-3">
          <div className="shrink-0 w-24 sm:w-28 flex flex-col items-start gap-1">
            <SpeakerChip
              speaker={t.speaker}
              labels={labels}
              onSave={handleSave}
              saving={isPending}
            />
            <span className="text-[10px] text-[color:var(--muted)] font-mono">
              {fmtTime(t.start)}
            </span>
          </div>
          <p className="flex-1 text-[14px] leading-relaxed text-[color:var(--foreground)] pt-0.5">
            {t.text.trim()}
          </p>
        </div>
      ))}
    </div>
  );
}

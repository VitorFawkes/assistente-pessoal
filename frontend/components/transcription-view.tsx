"use client";

import { cn } from "@/lib/utils";

export type Segment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

// Agrupa segments contíguos do mesmo speaker em "turnos".
function groupTurns(segments: Segment[]): Array<{
  speaker: string;
  start: number;
  end: number;
  text: string;
}> {
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

// Paleta estável por speaker letter (A, B, C…)
function speakerStyle(speaker: string): { bg: string; text: string; label: string } {
  const palette = [
    { bg: "bg-[color:var(--calm-bg)]", text: "text-[color:var(--calm)]" },
    { bg: "bg-[color:var(--warm-bg)]", text: "text-[color:var(--warm)]" },
    { bg: "bg-[color:var(--accent)]", text: "text-[color:var(--muted-strong)]" },
    { bg: "bg-[color:var(--urgent-bg)]", text: "text-[color:var(--urgent)]" },
  ];
  const idx = speaker.charCodeAt(0) - "A".charCodeAt(0);
  const p = palette[((idx % palette.length) + palette.length) % palette.length];
  return { ...p, label: `Speaker ${speaker}` };
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function TranscriptionView({
  segments,
  fallbackText,
}: {
  segments: Segment[] | null | undefined;
  fallbackText: string | null;
}) {
  // Sem segments — renderiza texto cru (compat com meetings antigas)
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
      {turns.map((t, i) => {
        const s = speakerStyle(t.speaker);
        return (
          <div key={i} className="flex gap-3">
            <div className="shrink-0 w-20 sm:w-24 flex flex-col items-start gap-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] tracking-wide font-medium px-2 py-0.5 rounded-full",
                  s.bg,
                  s.text,
                )}
              >
                {s.label}
              </span>
              <span className="text-[10px] text-[color:var(--muted)] font-mono">
                {fmtTime(t.start)}
              </span>
            </div>
            <p className="flex-1 text-[14px] leading-relaxed text-[color:var(--foreground)] pt-0.5">
              {t.text.trim()}
            </p>
          </div>
        );
      })}
    </div>
  );
}

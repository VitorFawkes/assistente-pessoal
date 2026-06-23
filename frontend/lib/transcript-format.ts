export type Segment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

export type Turn = {
  speaker: string;
  start: number;
  end: number;
  text: string;
  segmentIndices: number[];
};

export type Section = { start_seconds: number; title: string };

export function groupTurns(segments: Segment[]): Turn[] {
  if (!segments?.length) return [];
  const turns: Turn[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker) {
      last.end = s.end;
      last.text += s.text;
      last.segmentIndices.push(i);
    } else {
      turns.push({
        speaker: s.speaker,
        start: s.start,
        end: s.end,
        text: s.text,
        segmentIndices: [i],
      });
    }
  }
  return turns;
}

export function coerceSegments(raw: unknown): Segment[] {
  if (Array.isArray(raw)) return raw as Segment[];
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Segment[];
    } catch {
      // fall through
    }
  }
  return [];
}

export function speakerName(letter: string, labels: Record<string, string>): string {
  return labels[letter] || `Speaker ${letter}`;
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function toPlainText(segments: Segment[], labels: Record<string, string>): string {
  return groupTurns(segments)
    .map((t) => `[${fmtClock(t.start)}] ${speakerName(t.speaker, labels)}: ${t.text.trim()}`)
    .join("\n");
}

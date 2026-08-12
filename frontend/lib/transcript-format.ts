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
  return labels[letter] || `Voz ${letter}`;
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function stamp(seconds: number, sep: "," | "."): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}${sep}${String(ms).padStart(3, "0")}`;
}

export function toSrt(segments: Segment[], labels: Record<string, string>): string {
  return segments
    .map((seg, i) => {
      const line = `${speakerName(seg.speaker, labels)}: ${seg.text.trim()}`;
      return `${i + 1}\n${stamp(seg.start, ",")} --> ${stamp(seg.end, ",")}\n${line}\n`;
    })
    .join("\n");
}

export function toVtt(segments: Segment[], labels: Record<string, string>): string {
  const body = segments
    .map((seg) => {
      const line = `${speakerName(seg.speaker, labels)}: ${seg.text.trim()}`;
      return `${stamp(seg.start, ".")} --> ${stamp(seg.end, ".")}\n${line}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/** Só as falas em markdown, sem cabeçalho — pra compor com o resumo. */
export function turnsToMarkdown(
  segments: Segment[],
  labels: Record<string, string>,
): string {
  return groupTurns(segments)
    .map((t) => `**[${fmtClock(t.start)}] ${speakerName(t.speaker, labels)}:** ${t.text.trim()}`)
    .join("\n\n");
}

export function toMarkdown(
  segments: Segment[],
  labels: Record<string, string>,
  meta: { title: string; dateLabel: string; participants: string[] },
): string {
  const head =
    `# ${meta.title}\n\n` +
    `**Data:** ${meta.dateLabel}  \n` +
    `**Participantes:** ${meta.participants.join(", ")}\n\n` +
    `---\n\n`;
  return `${head}${turnsToMarkdown(segments, labels)}\n`;
}

/** Segmentos cujo start cai no intervalo da seção `index` (sorted por start_seconds). */
export function filterBySection(
  segments: Segment[],
  sections: Section[],
  index: number,
  duration: number,
): Segment[] {
  const sorted = [...sections].sort((a, b) => a.start_seconds - b.start_seconds);
  const start = sorted[index]?.start_seconds ?? 0;
  const end = sorted[index + 1]?.start_seconds ?? duration;
  return segments.filter((s) => s.start >= start && s.start < end);
}

/** Nomes distintos dos speakers (resolvidos), na ordem de aparição. */
export function participantNames(
  segments: Segment[],
  labels: Record<string, string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of segments) {
    const name = speakerName(s.speaker, labels);
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

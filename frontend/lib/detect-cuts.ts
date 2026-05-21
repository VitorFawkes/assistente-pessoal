export type Segment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

export type Cut = {
  at_seconds: number;
  confidence: number;
  reasons: string[];
};

export const DETECT_CONSTANTS = {
  // Thresholds calibrados pro pipeline atual: transcribe.sh aplica silenceremove
  // antes do Whisper, então gaps entre turnos são SEMPRE pequenos (max ~25s
  // observado em meetings reais de 70min). Valores aqui são pra capturar
  // "respiros" relativos, não silêncios absolutos.
  SILENCE_HARD: 20,
  SILENCE_SOFT: 10,
  SPEAKER_WINDOW: 300,
  SPEAKER_JACCARD_MAX: 0.3,
  SPEAKER_WEIGHT: 0.5,
  MIN_SEGMENT_DURATION: 600,
  CONFIDENCE_FLOOR: 0.7,
  MERGE_DISTANCE: 300,
} as const;

function fmtDur(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (sec === 0) return `${m}min`;
  return `${m}min${sec}s`;
}

function speakersInWindow(
  segments: Segment[],
  centerTime: number,
  windowSeconds: number,
  direction: "before" | "after",
): Set<string> {
  const out = new Set<string>();
  for (const s of segments) {
    if (direction === "before") {
      if (s.end <= centerTime && s.end >= centerTime - windowSeconds) {
        out.add(s.speaker);
      }
    } else {
      if (s.start >= centerTime && s.start <= centerTime + windowSeconds) {
        out.add(s.speaker);
      }
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = new Set<string>();
  for (const x of a) if (b.has(x)) inter.add(x);
  const uni = new Set<string>([...a, ...b]);
  return inter.size / uni.size;
}

export function detectCuts(segments: Segment[], duration: number): Cut[] {
  const C = DETECT_CONSTANTS;
  if (!segments || segments.length < 2) return [];

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const candidates: Cut[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const gap = next.start - curr.end;
    if (gap < C.SILENCE_SOFT) continue;

    const at = curr.end + gap / 2;
    const weight = gap >= C.SILENCE_HARD ? 1.0 : 0.5;
    const reasons = [`silêncio ${fmtDur(gap)}`];

    const before = speakersInWindow(sorted, at, C.SPEAKER_WINDOW, "before");
    const after = speakersInWindow(sorted, at, C.SPEAKER_WINDOW, "after");
    const jac = jaccard(before, after);
    const novos: string[] = [];
    for (const x of after) if (!before.has(x)) novos.push(x);

    let confidence = weight;
    if (jac < C.SPEAKER_JACCARD_MAX && novos.length > 0) {
      confidence += C.SPEAKER_WEIGHT;
      reasons.push(`speakers ${novos.sort().join(",")} novos`);
    }

    candidates.push({ at_seconds: at, confidence, reasons });
  }

  candidates.sort((a, b) => a.at_seconds - b.at_seconds);
  const merged: Cut[] = [];
  for (const c of candidates) {
    const last = merged[merged.length - 1];
    if (last && c.at_seconds - last.at_seconds < C.MERGE_DISTANCE) {
      if (c.confidence > last.confidence) merged[merged.length - 1] = c;
    } else {
      merged.push(c);
    }
  }

  const positions = [0, ...merged.map((c) => c.at_seconds), duration];
  const keep: Cut[] = [];
  for (let i = 0; i < merged.length; i++) {
    const leftDur = positions[i + 1] - positions[i];
    const rightDur = positions[i + 2] - positions[i + 1];
    if (leftDur >= C.MIN_SEGMENT_DURATION && rightDur >= C.MIN_SEGMENT_DURATION) {
      keep.push(merged[i]);
    }
  }

  return keep.filter((c) => c.confidence >= C.CONFIDENCE_FLOOR);
}

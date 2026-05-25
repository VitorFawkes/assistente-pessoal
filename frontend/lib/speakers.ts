// Utilitários de speaker compartilhados entre /reunioes/[id] (strip inline) e
// /reunioes/[id]/identificar (página dedicada).
import type { SpeakerCard, Turn } from "@/components/identify-speakers";

type Segment = { speaker: string; start: number; end: number; text: string };

export function groupTurns(segments: Segment[]): Turn[] {
  if (!segments?.length) return [];
  const turns: Turn[] = [];
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

export function buildSpeakerCards(
  segments: Segment[],
  labels: Record<string, string>,
): SpeakerCard[] {
  const turns = groupTurns(segments);
  const bySpeaker = new Map<string, Turn[]>();
  for (const t of turns) {
    if (!bySpeaker.has(t.speaker)) bySpeaker.set(t.speaker, []);
    bySpeaker.get(t.speaker)!.push(t);
  }

  const cards: SpeakerCard[] = [];
  for (const [letter, ts] of bySpeaker.entries()) {
    const totalSeconds = ts.reduce((acc, t) => acc + (t.end - t.start), 0);
    const top = ts
      .filter((t) => t.end - t.start >= 3)
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, 3);
    cards.push({
      letter,
      total_seconds: totalSeconds,
      total_turns: ts.length,
      current_label: labels[letter] || null,
      top_turns: top,
    });
  }

  // Não-rotulados primeiro, depois por total_seconds desc
  cards.sort((a, b) => {
    if (!a.current_label && b.current_label) return -1;
    if (a.current_label && !b.current_label) return 1;
    return b.total_seconds - a.total_seconds;
  });
  return cards;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requireUserOrRedirect } from "@/lib/auth";
import { pessoasFor } from "@/lib/queries";
import {
  IdentifySpeakers,
  type SpeakerCard,
  type Turn,
} from "@/components/identify-speakers";

export const dynamic = "force-dynamic";

type Segment = { speaker: string; start: number; end: number; text: string };

type MeetingRow = {
  id: string;
  summary: string | null;
  recorded_at: string | null;
  segments: Segment[] | null;
  speaker_labels: Record<string, string> | null;
};

function groupTurns(segments: Segment[]): Turn[] {
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

function buildSpeakerCards(
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
    // Top 3 turnos mais longos com pelo menos 3s
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

async function fetchMeeting(userId: string, id: string): Promise<MeetingRow | null> {
  return withTenant(userId, async (db) => {
    const r = await db.query<MeetingRow>(
      `SELECT id, summary,
              to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
              segments, speaker_labels
       FROM meetings WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  });
}

export default async function IdentificarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUserOrRedirect();
  const meeting = await fetchMeeting(user.id, id);
  if (!meeting) notFound();

  const segments = meeting.segments ?? [];
  const labels = meeting.speaker_labels ?? {};
  const speakers = buildSpeakerCards(segments, labels);

  const pessoas = await pessoasFor(user.id).listMinimal();

  const naoRotulados = speakers.filter((s) => !s.current_label).length;

  return (
    <div className="space-y-6 sm:space-y-8">
      <Link
        href={`/reunioes/${id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
      >
        <ArrowLeft size={14} /> voltar pra reunião
      </Link>

      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Identificar speakers
        </p>
        <h1 className="font-display text-3xl sm:text-4xl leading-[1.1]">
          Quem é{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            quem.
          </span>
        </h1>
        {meeting.summary && (
          <p className="text-[13px] text-[color:var(--muted)] line-clamp-2">
            {meeting.summary}
          </p>
        )}
        <p className="text-[13px] text-[color:var(--muted-strong)] max-w-md">
          Ouve os trechos de cada speaker abaixo, identifica a voz e rotula.
          Cada nome salvo já enrola a voz daquela pessoa pra reconhecimento
          automático em reuniões futuras.
        </p>
        {naoRotulados > 0 && (
          <p className="text-[12px] text-[color:var(--muted)]">
            {naoRotulados} speaker{naoRotulados === 1 ? "" : "s"} ainda sem
            nome.
          </p>
        )}
      </header>

      <IdentifySpeakers meetingId={id} speakers={speakers} pessoas={pessoas} />
    </div>
  );
}

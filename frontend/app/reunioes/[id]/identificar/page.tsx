import Link from "next/link";
import { meetingLabel } from "@/lib/meeting-label";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requireUserOrRedirect } from "@/lib/auth";
import { pessoasFor } from "@/lib/queries";
import { IdentifySpeakers } from "@/components/identify-speakers";
import { buildSpeakerCards } from "@/lib/speakers";

export const dynamic = "force-dynamic";

type Segment = { speaker: string; start: number; end: number; text: string };

type MeetingRow = {
  id: string;
  summary: string | null;
  recorded_at: string | null;
  segments: Segment[] | null;
  speaker_labels: Record<string, string> | null;
};

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
          Identificar vozes
        </p>
        <h1 className="font-display text-3xl sm:text-4xl leading-[1.1]">
          Quem é{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            quem.
          </span>
        </h1>
        {meeting.summary && (
          <p className="text-[13px] text-[color:var(--muted)] line-clamp-2">
            {meetingLabel(meeting.summary, meeting.recorded_at)}
          </p>
        )}
        <p className="text-[13px] text-[color:var(--muted-strong)] max-w-md">
          Escute os trechos de cada voz abaixo e diga de quem é. Cada nome que
          você salva ensina o sistema a reconhecer essa pessoa sozinho nas
          próximas gravações.
        </p>
        {naoRotulados > 0 && (
          <p className="text-[12px] text-[color:var(--muted)]">
            {naoRotulados} {naoRotulados === 1 ? "voz ainda sem nome" : "vozes ainda sem nome"}.
          </p>
        )}
      </header>

      <IdentifySpeakers meetingId={id} speakers={speakers} pessoas={pessoas} />
    </div>
  );
}

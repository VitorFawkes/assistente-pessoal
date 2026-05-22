import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requireUserOrRedirect } from "@/lib/auth";
import { detectCuts, type Segment } from "@/lib/detect-cuts";
import { SegmentTimeline } from "./segment-timeline";

export const dynamic = "force-dynamic";

type MeetingRow = {
  id: string;
  status: string;
  parent_meeting_id: string | null;
  duration_seconds: number | null;
  recorded_at: string | null;
  segments: Segment[] | null;
};

async function fetchMeeting(userId: string, id: string): Promise<MeetingRow | null> {
  return withTenant(userId, async (db) => {
    const r = await db.query<MeetingRow>(
      `SELECT id, status, parent_meeting_id, duration_seconds,
              to_char(coalesce(recorded_at, created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
              segments
       FROM meetings WHERE id = $1::uuid`,
      [id],
    );
    return r.rows[0] ?? null;
  });
}

export default async function SegmentarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUserOrRedirect();
  const meeting = await fetchMeeting(user.id, id);
  if (!meeting) redirect("/reunioes");
  if (meeting.parent_meeting_id) redirect(`/reunioes/${id}`);
  if (meeting.status === "archived_session") redirect("/reunioes");

  const segments = meeting.segments ?? [];
  const duration = meeting.duration_seconds || 0;

  if (segments.length === 0) {
    return (
      <div className="space-y-6">
        <Link
          href={`/reunioes/${id}`}
          className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
        >
          <ArrowLeft size={14} /> voltar pra reunião
        </Link>
        <div className="paper-card rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center space-y-4">
          <p className="text-sm text-[color:var(--muted)]">
            Esse áudio não tem transcrição diarizada — não dá pra detectar cortes
            automaticamente. Se é uma reunião só, marque como única. Caso queira
            descartar a sessão inteira, arquive.
          </p>
          <SegmentTimeline
            meetingId={id}
            initialCuts={[]}
            duration={duration}
            segments={[]}
            recordedAt={meeting.recorded_at}
            archiveOnly
          />
        </div>
      </div>
    );
  }

  const initialCuts = detectCuts(segments, duration);

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
          Segmentar áudio longo
        </p>
        <h1 className="font-display text-3xl sm:text-4xl leading-[1.1]">
          Onde uma reunião{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            vira outra.
          </span>
        </h1>
        <p className="text-[13px] text-[color:var(--muted-strong)] max-w-md">
          Confirma os cortes propostos ou ajusta manualmente. Cada segmento vira
          uma reunião independente com tarefas extraídas separadamente.
        </p>
      </header>

      <SegmentTimeline
        meetingId={id}
        initialCuts={initialCuts}
        duration={duration}
        segments={segments}
        recordedAt={meeting.recorded_at}
      />
    </div>
  );
}

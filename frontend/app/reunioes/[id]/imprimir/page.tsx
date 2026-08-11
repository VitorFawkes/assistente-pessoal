import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";
import { fmtDate } from "@/lib/utils";
import { coerceSegments, groupTurns, speakerName, fmtClock } from "@/lib/transcript-format";
import { meetingSubject } from "@/lib/meeting-label";
import { PrintTrigger } from "./print-trigger";

export const dynamic = "force-dynamic";

export default async function ImprimirPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUserOrRedirect();
  const m = await meetingsFor(user.id).forExport(id);
  if (!m) notFound();

  const segments = coerceSegments(m.segments);
  const labels = m.speaker_labels || {};
  const turns = groupTurns(segments);

  return (
    <div className="mx-auto max-w-3xl p-8 text-black bg-white print:p-0">
      <header className="mb-6">
        {/* No papel valia o mesmo: o resumo inteiro como título tomava meia
            página antes da transcrição começar. */}
        <h1 className="text-2xl font-semibold">
          {meetingSubject(m.summary) || "Reunião"}
        </h1>
        <p className="text-sm text-neutral-600 mt-1">
          {m.recorded_at ? fmtDate(m.recorded_at) : "sem data"}
        </p>
        {m.summary && (
          <p className="text-sm text-neutral-700 mt-2 leading-relaxed">{m.summary}</p>
        )}
      </header>
      <div className="space-y-3">
        {turns.map((t, i) => (
          <p key={i} className="text-[14px] leading-relaxed">
            <span className="font-mono text-neutral-500 text-[12px]">[{fmtClock(t.start)}]</span>{" "}
            <strong>{speakerName(t.speaker, labels)}:</strong> {t.text.trim()}
          </p>
        ))}
      </div>
      <PrintTrigger />
    </div>
  );
}

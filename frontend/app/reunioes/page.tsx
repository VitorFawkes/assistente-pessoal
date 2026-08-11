import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth";
import { MEETINGS_LIMIT, meetingsFor } from "@/lib/queries";
import { Archive } from "lucide-react";
import { MeetingsList, type MeetingItem } from "@/components/meetings-list";

export const dynamic = "force-dynamic";

type Meeting = MeetingItem;

export default async function ReunioesPage() {
  const user = await requireUserOrRedirect();
  let meetings: Meeting[] = [];
  let total = 0;
  let error: string | null = null;
  try {
    const [lista, n] = await Promise.all([
      meetingsFor(user.id).listForIndex(),
      meetingsFor(user.id).total(),
    ]);
    meetings = lista;
    total = n;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-6">
        <h2 className="text-sm font-semibold text-[color:var(--urgent)]">
          Erro ao carregar reuniões
        </h2>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-[color:var(--urgent)]/90">
          {error}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Reuniões
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          Histórico do que{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            foi capturado.
          </span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Tudo que foi gravado, da mais recente pra mais antiga.
        </p>
        <Link
          href="/reunioes/arquivadas"
          className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
        >
          <Archive size={12} /> ver arquivadas
        </Link>
      </header>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-12 text-center">
          <p className="text-sm text-[color:var(--muted)]">
            Nenhuma reunião processada ainda. Grave um áudio pra ele aparecer
            aqui em ~30s.
          </p>
        </div>
      ) : (
        <MeetingsList meetings={meetings} total={total} limite={MEETINGS_LIMIT} />
      )}
    </div>
  );
}

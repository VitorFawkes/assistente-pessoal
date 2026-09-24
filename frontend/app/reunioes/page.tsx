import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth";
import { MEETINGS_LIMIT, meetingsFor } from "@/lib/queries";
import { Archive } from "lucide-react";
import { MeetingsList, type MeetingItem } from "@/components/meetings-list";
import { isTeamMode } from "@/lib/team-mode";
import { Tabs } from "@/components/tabs";

export const dynamic = "force-dynamic";

export default async function ReunioesPage() {
  const user = await requireUserOrRedirect();
  const teamMode = isTeamMode();
  let meetingsMine: MeetingItem[] = [];
  let meetingsVisible: MeetingItem[] = [];
  let total = 0;
  let error: string | null = null;

  try {
    if (teamMode) {
      const [mine, visible, n] = await Promise.all([
        meetingsFor(user.id).listMineForIndex(),
        meetingsFor(user.id).listVisibleForIndex(),
        meetingsFor(user.id).total(),
      ]);
      meetingsMine = mine;
      meetingsVisible = visible;
      total = n;
    } else {
      const [lista, n] = await Promise.all([
        meetingsFor(user.id).listForIndex(),
        meetingsFor(user.id).total(),
      ]);
      meetingsMine = lista;
      total = n;
    }
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

  const headerContent = (
    <>
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
        {teamMode
          ? "Suas reuniões e as compartilhadas com você."
          : "Tudo que foi gravado, da mais recente pra mais antiga."}
      </p>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        {teamMode && (
          <Link
            href="/reunioes/gravar"
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-2xl bg-[color:var(--accent)] text-[color:var(--foreground)] font-medium text-sm hover:opacity-90 transition"
          >
            Gravar reunião
          </Link>
        )}
        <Link
          href="/reunioes/arquivadas"
          className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
        >
          <Archive size={12} /> ver arquivadas
        </Link>
      </div>
    </>
  );

  const emptyStateContent = (
    <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-12 text-center">
      <p className="text-sm text-[color:var(--muted)]">
        Nenhuma reunião processada ainda. Grave um áudio pra ele aparecer
        aqui em ~30s.
      </p>
    </div>
  );

  if (!teamMode) {
    return (
      <div className="space-y-7 sm:space-y-9">
        <header className="space-y-2">{headerContent}</header>

        {meetingsMine.length === 0 ? (
          emptyStateContent
        ) : (
          <MeetingsList meetings={meetingsMine} total={total} limite={MEETINGS_LIMIT} isAdmin={user.is_admin} />
        )}
      </div>
    );
  }

  // TEAM_MODE: exibir abas
  return (
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">{headerContent}</header>

      <Tabs
        items={[
          {
            key: "minhas",
            label: "Minhas",
            count: meetingsMine.length,
            content:
              meetingsMine.length === 0 ? (
                emptyStateContent
              ) : (
                <MeetingsList meetings={meetingsMine} total={total} limite={MEETINGS_LIMIT} isAdmin={user.is_admin} />
              ),
          },
          {
            key: "equipe",
            label: "Da equipe",
            count: meetingsVisible.filter((m: any) => m.user_id !== user.id).length,
            content:
              meetingsVisible.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-12 text-center">
                  <p className="text-sm text-[color:var(--muted)]">
                    Nenhuma reunião compartilhada ainda.
                  </p>
                </div>
              ) : (
                <MeetingsList
                  meetings={meetingsVisible.filter((m: any) => m.user_id !== user.id)}
                  total={meetingsVisible.length}
                  limite={MEETINGS_LIMIT}
                  isAdmin={user.is_admin}
                  somenteLeitura
                />
              ),
          },
        ]}
        defaultKey="minhas"
      />
    </div>
  );
}

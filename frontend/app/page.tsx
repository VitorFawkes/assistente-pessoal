import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth";
import { isTeamMode } from "@/lib/team-mode";
import { ABERTAS_LIMIT, tarefasFor, meetingsFor } from "@/lib/queries";
import { type Tarefa } from "@/lib/queries";
import { TasksDashboard } from "@/components/tasks-dashboard";
import { OwnerTaskProvider } from "@/lib/task-mutations";
import { comProjetos, tarefasParaMim } from "@/lib/equipe-compartilhado";
import { ordenarPendencias } from "@/lib/compartilhar";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUserOrRedirect();
  const teamMode = isTeamMode();

  let tarefas: Tarefa[] = [];
  let totalAbertas = 0;
  let meetings: any[] = [];
  let dbError: string | null = null;
  try {
    // tarefasFor.recentes() retorna abertas + concluídas/canceladas com meeting joinado.
    // RLS filtra por user_id automaticamente. UI filtra por status.
    const [lista, contagens, meetingsList, paraMim] = await Promise.all([
      tarefasFor(user.id).recentes(),
      tarefasFor(user.id).contagens(),
      teamMode ? meetingsFor(user.id).list() : Promise.resolve([]),
      tarefasParaMim(user.id),
    ]);
    // Equipe: as que colegas passaram pra mim entram na mesma lista (já como minhas).
    tarefas = paraMim.length
      ? [...(lista as unknown as Tarefa[]), ...paraMim].sort(ordenarPendencias)
      : (lista as unknown as Tarefa[]);
    tarefas = await comProjetos(user.id, tarefas);
    totalAbertas =
      contagens.abertas +
      paraMim.filter((t) => t.status === "aberta" || t.status === "em_andamento").length;
    meetings = meetingsList;
  } catch (e: unknown) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  if (dbError) {
    return (
      <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-6">
        <h2 className="text-sm font-semibold text-[color:var(--urgent)]">
          Não consegui conectar no banco
        </h2>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-[color:var(--urgent)]/90">
          {dbError}
        </pre>
        <p className="mt-3 text-xs text-[color:var(--muted-strong)]">
          Confirme se <code>DATABASE_URL</code> está definida no ambiente e se o
          Postgres está acessível.
        </p>
      </div>
    );
  }

  // Em TEAM_MODE, se não houver reuniões, mostrar o bloco de primeiro uso
  if (teamMode && meetings.length === 0 && tarefas.length === 0) {
    return (
      <div className="space-y-6 py-6 sm:py-10">
        <header>
          <h1 className="font-display text-3xl sm:text-4xl leading-tight mb-3">
            Bem-vindo ao Ações
          </h1>
          <p className="text-[color:var(--muted-strong)] max-w-lg">
            Grave suas reuniões e receba automaticamente um resumo com as tarefas extraídas.
          </p>
        </header>

        <div className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--card)] p-8 sm:p-10">
          <h2 className="font-display text-2xl mb-6">Grave sua primeira reunião</h2>
          <Link
            href="/reunioes/gravar"
            className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-[color:var(--accent)] text-[color:var(--foreground)] font-medium text-base hover:opacity-90 transition"
          >
            Começar a gravar
          </Link>
          <p className="mt-6 text-sm text-[color:var(--muted-strong)]">
            ou <Link href="/reunioes" className="underline hover:no-underline">suba um arquivo de áudio</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <OwnerTaskProvider>
      <div className="space-y-4">
        <header className="flex items-baseline gap-3">
          <h1 className="font-display text-2xl sm:text-3xl leading-tight">
            O que está{" "}
            <span className="italic font-[450] text-[color:var(--muted-strong)]">
              combinado.
            </span>
          </h1>
          <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
            Pendências
          </p>
        </header>

        <TasksDashboard
          tarefas={tarefas}
          totalAbertas={totalAbertas}
          limiteAbertas={ABERTAS_LIMIT}
        />
      </div>
    </OwnerTaskProvider>
  );
}

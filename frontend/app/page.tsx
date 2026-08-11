import { requireUserOrRedirect } from "@/lib/auth";
import { ABERTAS_LIMIT, tarefasFor } from "@/lib/queries";
import { type Tarefa } from "@/lib/queries";
import { TasksDashboard } from "@/components/tasks-dashboard";
import { OwnerTaskProvider } from "@/lib/task-mutations";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUserOrRedirect();

  let tarefas: Tarefa[] = [];
  let totalAbertas = 0;
  let dbError: string | null = null;
  try {
    // tarefasFor.recentes() retorna abertas + concluídas/canceladas com meeting joinado.
    // RLS filtra por user_id automaticamente. UI filtra por status.
    const [lista, contagens] = await Promise.all([
      tarefasFor(user.id).recentes(),
      tarefasFor(user.id).contagens(),
    ]);
    tarefas = lista as unknown as Tarefa[];
    totalAbertas = contagens.abertas;
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

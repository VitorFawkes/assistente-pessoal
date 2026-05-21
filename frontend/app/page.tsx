import { requireUserOrRedirect } from "@/lib/auth";
import { tarefasFor } from "@/lib/queries";
import { type Tarefa } from "@/components/task-row";
import { TasksDashboard } from "@/components/tasks-dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUserOrRedirect();

  let tarefas: Tarefa[] = [];
  let dbError: string | null = null;
  try {
    // tarefasFor.abertas() já retorna com meeting_recorded_at + meeting_summary
    // joinados. RLS filtra por user_id automaticamente.
    tarefas = (await tarefasFor(user.id).abertas()) as unknown as Tarefa[];
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
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Pendências
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          O que está{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            combinado.
          </span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Tudo que apareceu nas suas reuniões e voice notes, capturado e
          organizado pra você não perder nada.
        </p>
      </header>

      <TasksDashboard tarefas={tarefas} />
    </div>
  );
}

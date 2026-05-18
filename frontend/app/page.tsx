import { query } from "@/lib/db";
import { type Tarefa } from "@/components/task-row";
import { TasksDashboard } from "@/components/tasks-dashboard";

export const dynamic = "force-dynamic";

async function fetchTarefas(): Promise<Tarefa[]> {
  return query<Tarefa>(`
    SELECT
      t.id, t.meeting_id, t.titulo, t.descricao, t.owner, t.is_mine,
      to_char(t.prazo AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS prazo,
      t.prazo_text, t.prioridade, t.status, t.evidencia,
      to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
      to_char(m.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS meeting_recorded_at,
      m.summary AS meeting_summary
    FROM tarefas t
    LEFT JOIN meetings m ON m.id = t.meeting_id
    WHERE t.status IN ('aberta','em_andamento')
    ORDER BY (t.prazo IS NULL), t.prazo ASC, t.created_at DESC
    LIMIT 200;
  `);
}

export default async function HomePage() {
  let tarefas: Tarefa[] = [];
  let dbError: string | null = null;
  try {
    tarefas = await fetchTarefas();
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

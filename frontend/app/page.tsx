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
      <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-6">
        <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
          Não consegui conectar no banco
        </h2>
        <pre className="mt-2 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">
          {dbError}
        </pre>
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          Confirme se <code>DATABASE_URL</code> está definida no ambiente e se o Postgres está acessível.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pendências</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          Tudo que ficou combinado nas suas reuniões e voice notes.
        </p>
      </div>

      <TasksDashboard tarefas={tarefas} />
    </div>
  );
}

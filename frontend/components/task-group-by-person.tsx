import { UserRound } from "lucide-react";
import { TaskRow, type Tarefa } from "./task-row";

// Agrupa por pessoa principal (a marcada principal=true); sem principal → "Você".
function groupKey(t: Tarefa): { id: string; nome: string; ehVoce: boolean } {
  const principal = (t.pessoas ?? []).find((p) => p.principal);
  if (principal) return { id: principal.id, nome: principal.nome, ehVoce: false };
  return { id: "__voce__", nome: "Você", ehVoce: true };
}

export function TaskGroupByPerson({ tarefas }: { tarefas: Tarefa[] }) {
  const groups = new Map<
    string,
    { nome: string; ehVoce: boolean; items: Tarefa[] }
  >();
  for (const t of tarefas) {
    const k = groupKey(t);
    const g = groups.get(k.id) ?? { nome: k.nome, ehVoce: k.ehVoce, items: [] };
    g.items.push(t);
    groups.set(k.id, g);
  }
  // "Você" primeiro, depois por nome.
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.ehVoce !== b.ehVoce) return a.ehVoce ? -1 : 1;
    return a.nome.localeCompare(b.nome);
  });

  return (
    <div className="space-y-5">
      {ordered.map((g) => (
        <div key={g.nome} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <UserRound size={13} className="text-[color:var(--muted-strong)]" />
            <span className="text-[12px] tracking-wide text-[color:var(--muted-strong)] font-medium">
              {g.nome}
            </span>
            <span className="text-[11px] text-[color:var(--muted)]">
              · {g.items.length}
            </span>
          </div>
          <div className="space-y-2">
            {g.items.map((t) => (
              <TaskRow key={t.id} tarefa={t} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

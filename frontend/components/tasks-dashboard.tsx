"use client";

import { useMemo, useState } from "react";
import { TaskRow, type Tarefa } from "./task-row";
import { Tabs } from "./tabs";
import { DateFilter, filterByDate, type DateBucket } from "./date-filter";

export function TasksDashboard({ tarefas }: { tarefas: Tarefa[] }) {
  const [bucket, setBucket] = useState<DateBucket>("todos");

  const counts = useMemo(() => {
    const bs: DateBucket[] = ["todos", "vencidas", "hoje", "semana", "mes", "sem_prazo"];
    return Object.fromEntries(
      bs.map((b) => [b, filterByDate(tarefas, b).length]),
    ) as Record<DateBucket, number>;
  }, [tarefas]);

  const filtered = useMemo(() => filterByDate(tarefas, bucket), [tarefas, bucket]);

  const minhas = filtered.filter((t) => t.is_mine);
  const delegadas = filtered.filter((t) => !t.is_mine);

  const renderList = (list: Tarefa[], empty: string) => {
    if (!list.length) {
      return (
        <div className="rounded-lg border border-dashed border-[color:var(--border)] p-8 text-center text-sm text-[color:var(--muted)]">
          {empty}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {list.map((t) => (
          <TaskRow key={t.id} tarefa={t} />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <DateFilter value={bucket} onChange={setBucket} counts={counts} />
      <Tabs
        items={[
          {
            key: "minhas",
            label: "Minhas",
            count: minhas.length,
            content: renderList(minhas, "Nada pendente seu nesse filtro."),
          },
          {
            key: "delegadas",
            label: "Aguardando outros",
            count: delegadas.length,
            content: renderList(delegadas, "Nada aguardando nesse filtro."),
          },
          {
            key: "todas",
            label: "Todas",
            count: filtered.length,
            content: renderList(filtered, "Nenhuma pendência nesse filtro."),
          },
        ]}
      />
    </div>
  );
}

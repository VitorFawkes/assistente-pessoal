"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { TaskRow, type Tarefa } from "./task-row";
import { Tabs } from "./tabs";
import { DateFilter, filterByDate, type DateBucket } from "./date-filter";

export function TasksDashboard({ tarefas }: { tarefas: Tarefa[] }) {
  const [bucket, setBucket] = useState<DateBucket>("todos");

  const counts = useMemo(() => {
    const bs: DateBucket[] = [
      "todos",
      "vencidas",
      "hoje",
      "semana",
      "mes",
      "sem_prazo",
    ];
    return Object.fromEntries(
      bs.map((b) => [b, filterByDate(tarefas, b).length]),
    ) as Record<DateBucket, number>;
  }, [tarefas]);

  const filtered = useMemo(
    () => filterByDate(tarefas, bucket),
    [tarefas, bucket],
  );

  const minhas = filtered.filter((t) => t.is_mine);
  const delegadas = filtered.filter((t) => !t.is_mine);

  const renderList = (list: Tarefa[], empty: string) => {
    if (!list.length) {
      return (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] py-12 px-6 text-center">
          <Sparkles
            size={20}
            strokeWidth={1.5}
            className="mx-auto mb-3 text-[color:var(--muted)]"
          />
          <p className="text-[14px] text-[color:var(--muted-strong)]">
            {empty}
          </p>
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
    <div className="space-y-5">
      <DateFilter value={bucket} onChange={setBucket} counts={counts} />
      <Tabs
        items={[
          {
            key: "minhas",
            label: "Minhas",
            count: minhas.length,
            content: renderList(
              minhas,
              tarefas.length === 0
                ? "Nada por aqui ainda. Grave um áudio e em ~30s aparece."
                : "Nada pendente seu nesse filtro.",
            ),
          },
          {
            key: "delegadas",
            label: "Aguardando",
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

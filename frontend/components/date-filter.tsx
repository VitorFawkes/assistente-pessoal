"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Tarefa } from "./task-row";

export type DateBucket = "todos" | "vencidas" | "hoje" | "semana" | "mes" | "sem_prazo";

const LABELS: Record<DateBucket, string> = {
  todos: "Todos prazos",
  vencidas: "Vencidas",
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
  sem_prazo: "Sem prazo",
};

export function filterByDate(tarefas: Tarefa[], bucket: DateBucket): Tarefa[] {
  if (bucket === "todos") return tarefas;
  const now = new Date();
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  // Esta semana = até fim do domingo (próximo)
  const endWeek = new Date(now);
  const daysToSunday = (7 - now.getDay()) % 7;
  endWeek.setDate(endWeek.getDate() + daysToSunday);
  endWeek.setHours(23, 59, 59, 999);

  // Este mês = até último dia do mês
  const endMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  return tarefas.filter((t) => {
    if (bucket === "sem_prazo") return !t.prazo;
    if (!t.prazo) return false;
    const p = new Date(t.prazo);
    if (Number.isNaN(p.getTime())) return false;
    switch (bucket) {
      case "vencidas":
        return p < startToday;
      case "hoje":
        return p >= startToday && p <= endToday;
      case "semana":
        return p >= startToday && p <= endWeek;
      case "mes":
        return p >= startToday && p <= endMonth;
    }
  });
}

export function DateFilter({
  value,
  onChange,
  counts,
}: {
  value: DateBucket;
  onChange: (b: DateBucket) => void;
  counts: Record<DateBucket, number>;
}) {
  const buckets: DateBucket[] = ["todos", "vencidas", "hoje", "semana", "mes", "sem_prazo"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {buckets.map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onChange(b)}
          className={cn(
            "text-xs px-2.5 py-1 rounded-full border transition",
            b === value
              ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
              : "border-[color:var(--border)] text-[color:var(--muted)] hover:text-[color:var(--foreground)]",
          )}
        >
          {LABELS[b]}
          {counts[b] > 0 && (
            <span
              className={cn(
                "ml-1.5 text-[10px] font-medium",
                b === value ? "" : "text-zinc-400",
              )}
            >
              {counts[b]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function useDateBucket(initial: DateBucket = "todos") {
  const [bucket, setBucket] = useState<DateBucket>(initial);
  return [bucket, setBucket] as const;
}

export function useFilteredAndCounted(tarefas: Tarefa[]) {
  return useMemo(() => {
    const buckets: DateBucket[] = ["todos", "vencidas", "hoje", "semana", "mes", "sem_prazo"];
    const counts = Object.fromEntries(
      buckets.map((b) => [b, filterByDate(tarefas, b).length]),
    ) as Record<DateBucket, number>;
    return { counts };
  }, [tarefas]);
}

"use client";

import { useMemo, useState } from "react";
import { cn, nowSP, toSP } from "@/lib/utils";
import type { Tarefa } from "./task-row";

export type DateBucket =
  | "todos"
  | "vencidas"
  | "hoje"
  | "semana"
  | "mes"
  | "sem_prazo";

const LABELS: Record<DateBucket, string> = {
  todos: "Todos",
  vencidas: "Vencidas",
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
  sem_prazo: "Sem prazo",
};

const ACCENT: Record<DateBucket, string> = {
  todos: "",
  vencidas: "text-[color:var(--urgent)]",
  hoje: "text-[color:var(--warm)]",
  semana: "text-[color:var(--muted-strong)]",
  mes: "text-[color:var(--muted-strong)]",
  sem_prazo: "text-[color:var(--muted)]",
};

export function filterByDate(tarefas: Tarefa[], bucket: DateBucket): Tarefa[] {
  if (bucket === "todos") return tarefas;
  const now = nowSP();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);

  const endWeek = new Date(now);
  const daysToSunday = (7 - now.getDay()) % 7;
  endWeek.setDate(endWeek.getDate() + daysToSunday);
  endWeek.setHours(23, 59, 59, 999);

  const endMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  return tarefas.filter((t) => {
    if (bucket === "sem_prazo") return !t.prazo;
    if (!t.prazo) return false;
    const p = toSP(t.prazo);
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
  const buckets: DateBucket[] = [
    "todos",
    "vencidas",
    "hoje",
    "semana",
    "mes",
    "sem_prazo",
  ];
  return (
    <div className="-mx-5 sm:-mx-6 px-5 sm:px-6 overflow-x-auto scrollbar-none">
      <div className="flex gap-1.5 w-max">
        {buckets.map((b) => {
          const active = b === value;
          const count = counts[b];
          return (
            <button
              key={b}
              type="button"
              onClick={() => onChange(b)}
              className={cn(
                "press-feedback shrink-0 inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full border touch-manipulation",
                active
                  ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)]"
                  : "bg-[color:var(--card)] border-[color:var(--border)] text-[color:var(--muted-strong)] hover:border-[color:var(--muted)]",
              )}
            >
              <span className={cn(!active && ACCENT[b])}>{LABELS[b]}</span>
              {count > 0 && (
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    active
                      ? "text-[color:var(--background)] opacity-70"
                      : "text-[color:var(--muted)]",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function useDateBucket(initial: DateBucket = "todos") {
  const [bucket, setBucket] = useState<DateBucket>(initial);
  return [bucket, setBucket] as const;
}

export function useFilteredAndCounted(tarefas: Tarefa[]) {
  return useMemo(() => {
    const buckets: DateBucket[] = [
      "todos",
      "vencidas",
      "hoje",
      "semana",
      "mes",
      "sem_prazo",
    ];
    const counts = Object.fromEntries(
      buckets.map((b) => [b, filterByDate(tarefas, b).length]),
    ) as Record<DateBucket, number>;
    return { counts };
  }, [tarefas]);
}

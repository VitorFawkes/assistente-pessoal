"use client";

import { cn } from "@/lib/utils";
import type { Tarefa } from "./task-row";

export type CreatedBucket = "todas" | "hoje" | "semana" | "mes";

const LABELS: Record<CreatedBucket, string> = {
  todas: "Todas",
  hoje: "Criadas hoje",
  semana: "Esta semana",
  mes: "Este mês",
};

export function filterByCreated(
  tarefas: Tarefa[],
  bucket: CreatedBucket,
): Tarefa[] {
  if (bucket === "todas") return tarefas;
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  const startWeek = new Date(startToday);
  startWeek.setDate(startWeek.getDate() - startWeek.getDay()); // domingo

  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  return tarefas.filter((t) => {
    if (!t.created_at) return false;
    const c = new Date(t.created_at);
    if (Number.isNaN(c.getTime())) return false;
    switch (bucket) {
      case "hoje":
        return c >= startToday;
      case "semana":
        return c >= startWeek;
      case "mes":
        return c >= startMonth;
    }
  });
}

export function CreatedFilter({
  value,
  onChange,
  counts,
}: {
  value: CreatedBucket;
  onChange: (b: CreatedBucket) => void;
  counts: Record<CreatedBucket, number>;
}) {
  const buckets: CreatedBucket[] = ["todas", "hoje", "semana", "mes"];
  return (
    <div className="-mx-5 sm:-mx-6 px-5 sm:px-6 overflow-x-auto scrollbar-none">
      <div className="flex items-center gap-2 w-max">
        <span className="text-[10px] tracking-[0.18em] uppercase font-semibold text-[color:var(--muted)] shrink-0">
          Criação
        </span>
        <div className="flex gap-1.5">
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
                <span>{LABELS[b]}</span>
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
    </div>
  );
}

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Calendário próprio — o picker nativo do SO foi descartado no projeto. */
export function MiniCalendar({
  selected,
  onPick,
}: {
  selected: Date | null;
  onPick: (d: Date) => void;
}) {
  const today = new Date();
  // Mês visível: o do prazo atual, senão o de hoje.
  const [view, setView] = useState(() => {
    const base = selected ?? today;
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  const first = new Date(view.y, view.m, 1);
  const startPad = first.getDay(); // 0=domingo
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.y, view.m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (delta: number) => {
    const m = view.m + delta;
    setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
  };

  return (
    <div className="px-1 pt-1">
      <div className="flex items-center justify-between px-1 mb-1.5">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Mês anterior"
          className="p-1 rounded-md text-[color:var(--muted)] hover:bg-[color:var(--accent)] hover:text-[color:var(--foreground)]"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-[12px] font-medium text-[color:var(--foreground)] capitalize">
          {MESES[view.m]} {view.y}
        </span>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Próximo mês"
          className="p-1 rounded-md text-[color:var(--muted)] hover:bg-[color:var(--accent)] hover:text-[color:var(--foreground)]"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w, i) => (
          <span
            key={i}
            className="text-center text-[10px] font-medium text-[color:var(--muted)] py-0.5"
          >
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) =>
          d === null ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => onPick(d)}
              className={cn(
                "aspect-square flex items-center justify-center text-[12px] rounded-md transition",
                selected && sameDay(d, selected)
                  ? "bg-[color:var(--foreground)] text-[color:var(--background)] font-semibold"
                  : sameDay(d, today)
                  ? "ring-1 ring-[color:var(--warm)]/60 text-[color:var(--warm)] font-medium hover:bg-[color:var(--accent)]"
                  : "text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
              )}
            >
              {d.getDate()}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type Opt = { value: string; label: string; count: number };

// Dropdown multiselect compacto com contagem — reutilizado no picker de tarefas
// e na visão de tarefas do quadro.
export function FacetDropdown({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Opt[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const n = selected.size;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-full border transition whitespace-nowrap",
          n > 0
            ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)]"
            : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
        )}
      >
        {label}
        {n > 0 && <span className="opacity-80">· {n}</span>}
        <ChevronDown size={12} className={cn("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-56 max-h-72 overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-1.5">
          {options.length === 0 ? (
            <p className="text-[12px] text-[color:var(--muted)] px-2 py-2">nada aqui</p>
          ) : (
            options.map((o) => {
              const on = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onToggle(o.value)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[13px] hover:bg-[color:var(--accent)]/50"
                >
                  <span
                    className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                      on
                        ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
                        : "border-[color:var(--muted)]/60",
                    )}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{o.label}</span>
                  <span className="text-[11px] text-[color:var(--muted)]">{o.count}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

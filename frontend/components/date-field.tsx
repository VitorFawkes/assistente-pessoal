"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiniCalendar } from "./mini-calendar";

// Data em "YYYY-MM-DD" (o formato que os filtros e o prazo usam), sem passar
// por UTC — new Date("2026-08-11") cai no dia anterior no fuso de SP.
function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function fromKey(key: string): Date | null {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function label(key: string): string {
  const d = fromKey(key);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * Campo de data com o calendário do próprio app — o `<input type="date">`
 * abre o seletor do sistema operacional, que já foi descartado aqui.
 */
export function DateField({
  value,
  onChange,
  placeholder = "escolher data",
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (key: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap text-[12px] px-2 py-1 rounded-lg border border-[color:var(--border)] transition hover:bg-[color:var(--accent)]",
          value ? "text-[color:var(--foreground)]" : "text-[color:var(--muted)]",
          className,
        )}
      >
        <CalendarClock size={12} className="shrink-0" />
        <span className="tabular-nums">{value ? label(value) : placeholder}</span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpar data"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onChange("");
              }
            }}
            className="shrink-0 -mr-0.5 p-0.5 rounded text-[color:var(--muted)] hover:text-[color:var(--urgent)] cursor-pointer"
          >
            <X size={11} />
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-[248px] rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-1.5">
          <MiniCalendar
            selected={value ? fromKey(value) : null}
            onPick={(d) => {
              onChange(toKey(d));
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

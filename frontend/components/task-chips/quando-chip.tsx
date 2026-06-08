"use client";
import { CalendarClock } from "lucide-react";
import { Popover } from "./popover";
import { cn } from "@/lib/utils";

function nextWeekday(target: number): Date {
  const d = new Date(); const delta = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta); return d;
}
function isoEndOfDay(d: Date): string {
  const x = new Date(d); x.setHours(23, 59, 0, 0); return x.toISOString();
}
function label(iso: string | null): string {
  if (!iso) return "+ quando";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function QuandoChip({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const quick: { k: string; label: string; date: () => Date }[] = [
    { k: "hoje", label: "Hoje", date: () => new Date() },
    { k: "amanha", label: "Amanhã", date: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; } },
    { k: "sexta", label: "Sexta", date: () => nextWeekday(5) },
    { k: "prox", label: "+1 semana", date: () => { const d = new Date(); d.setDate(d.getDate() + 7); return d; } },
  ];
  return (
    <Popover ariaLabel="Mudar prazo"
      trigger={() => (
        <span className={cn("inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full",
          value ? "bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
                : "border border-dashed border-[color:var(--border)] text-[color:var(--muted)]")}>
          <CalendarClock size={11} /> {label(value)}
        </span>
      )}>
      {(close) => (
        <div className="flex flex-col">
          {quick.map((q) => (
            <button key={q.k} type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)]"
              onClick={() => { onChange(isoEndOfDay(q.date())); close(); }}>{q.label}</button>
          ))}
          <input type="date" className="mt-1 px-2 py-1 text-sm rounded border border-[color:var(--border)] bg-transparent"
            onChange={(e) => { const v = e.target.value; if (v) { const [y, m, d] = v.split("-").map(Number); onChange(isoEndOfDay(new Date(y, m - 1, d))); close(); } }} />
          {value && (
            <button type="button" className="text-left text-sm px-2 py-1.5 rounded text-[color:var(--urgent)] hover:bg-[color:var(--accent)]"
              onClick={() => { onChange(null); close(); }}>remover prazo</button>
          )}
        </div>
      )}
    </Popover>
  );
}

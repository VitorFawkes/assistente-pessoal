"use client";
import { CalendarClock } from "lucide-react";
import { Popover } from "./popover";
import { cn } from "@/lib/utils";
import { diaMesBR, fimDoDiaBR, hojeBR, maisDiasBR, proximoDiaDaSemanaBR } from "@/lib/data-br";

// Sempre o calendário de Brasília (ver lib/data-br.ts).
const label = (iso: string | null): string => (iso ? diaMesBR(iso) : "+ quando");

export function QuandoChip({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const quick: { k: string; label: string; dia: () => string }[] = [
    { k: "hoje", label: "Hoje", dia: () => hojeBR() },
    { k: "amanha", label: "Amanhã", dia: () => maisDiasBR(1) },
    { k: "sexta", label: "Sexta", dia: () => proximoDiaDaSemanaBR(5) },
    { k: "prox", label: "+1 semana", dia: () => maisDiasBR(7) },
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
              onClick={() => { onChange(fimDoDiaBR(q.dia())); close(); }}>{q.label}</button>
          ))}
          <input type="date" className="mt-1 px-2 py-1 text-sm rounded border border-[color:var(--border)] bg-transparent"
            onChange={(e) => { const v = e.target.value; if (v) { onChange(fimDoDiaBR(v)); close(); } }} />
          {value && (
            <button type="button" className="text-left text-sm px-2 py-1.5 rounded text-[color:var(--urgent)] hover:bg-[color:var(--accent)]"
              onClick={() => { onChange(null); close(); }}>remover prazo</button>
          )}
        </div>
      )}
    </Popover>
  );
}

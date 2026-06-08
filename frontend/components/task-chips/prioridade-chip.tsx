"use client";
import { Flame } from "lucide-react";
import { Popover } from "./popover";
import { cn, type Prioridade } from "@/lib/utils";

const OPTS: Prioridade[] = ["baixa", "media", "alta", "urgente"];

export function PrioridadeChip({ value, onChange }: { value: Prioridade; onChange: (p: Prioridade) => void }) {
  return (
    <Popover ariaLabel="Mudar prioridade"
      trigger={() => (
        <span className={cn("inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full",
          value === "urgente" ? "bg-[color:var(--urgent)] text-white"
          : value === "alta" ? "bg-[color:var(--warm-bg)] text-[color:var(--warm)]"
          : "bg-[color:var(--accent)] text-[color:var(--muted-strong)]")}>
          <Flame size={11} /> {value}
        </span>
      )}>
      {(close) => (
        <div className="flex flex-col">
          {OPTS.map((p) => (
            <button key={p} type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)]"
              onClick={() => { onChange(p); close(); }}>{p}</button>
          ))}
        </div>
      )}
    </Popover>
  );
}

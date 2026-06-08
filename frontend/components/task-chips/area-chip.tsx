"use client";
import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import { Popover } from "./popover";
import { cn } from "@/lib/utils";

export function AreaChip({ value, onChange }: { value: string | null; onChange: (frente: { id: string; nome: string } | null) => void }) {
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => { fetch("/api/frentes").then((r) => r.json()).then((d) => setFrentes(d.frentes ?? [])).catch(() => {}); }, []);
  return (
    <Popover ariaLabel="Mudar área"
      trigger={() => (
        <span className={cn("inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full",
          value ? "bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
                : "border border-dashed border-[color:var(--border)] text-[color:var(--muted)]")}>
          <Tag size={11} /> {value ?? "+ área"}
        </span>
      )}>
      {(close) => (
        <div className="flex flex-col max-h-64 overflow-y-auto">
          <button type="button" className="text-left text-sm px-2 py-1.5 rounded text-[color:var(--muted)] hover:bg-[color:var(--accent)]"
            onClick={() => { onChange(null); close(); }}>— sem área —</button>
          {frentes.map((f) => (
            <button key={f.id} type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)]"
              onClick={() => { onChange({ id: f.id, nome: f.nome }); close(); }}>{f.nome}</button>
          ))}
        </div>
      )}
    </Popover>
  );
}

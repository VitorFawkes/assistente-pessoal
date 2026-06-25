"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreatedBucket } from "./created-filter";

type GroupMode = "prazo" | "frente";

// Menu "Ver" — agrupa controles secundários (agrupar por + filtro de criação)
// pra tirar 2 fileiras de cima da tela. Fecha ao clicar fora.
export function ViewMenu({
  groupMode,
  onGroupMode,
  showGroup,
  createdBucket,
  onCreatedBucket,
  createdCounts,
}: {
  groupMode: GroupMode;
  onGroupMode: (m: GroupMode) => void;
  showGroup: boolean;
  createdBucket: CreatedBucket;
  onCreatedBucket: (b: CreatedBucket) => void;
  createdCounts: Record<CreatedBucket, number>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Indica visualmente se há algum filtro/visão "não-padrão" ativo.
  const active = groupMode !== "prazo" || createdBucket !== "todas";

  const CREATED: { k: CreatedBucket; label: string }[] = [
    { k: "todas", label: "Qualquer data" },
    { k: "hoje", label: "Criadas hoje" },
    { k: "semana", label: "Esta semana" },
    { k: "mes", label: "Este mês" },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "press-feedback inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full border transition cursor-pointer",
          active || open
            ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)]"
            : "bg-[color:var(--card)] border-[color:var(--border)] text-[color:var(--muted-strong)] hover:border-[color:var(--muted)]",
        )}
      >
        <SlidersHorizontal size={13} />
        Ver
        {active && (
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              open ? "bg-[color:var(--background)]" : "bg-[color:var(--urgent)]",
            )}
          />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 z-30 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-3 space-y-3">
          {showGroup && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted)] mb-1.5">
                Agrupar por
              </p>
              <div className="flex gap-1.5">
                {(
                  [
                    ["prazo", "Prazo"],
                    ["frente", "Área"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onGroupMode(m)}
                    className={cn(
                      "flex-1 text-[13px] px-3 py-1.5 rounded-full border transition",
                      groupMode === m
                        ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)] font-medium"
                        : "border-[color:var(--border)] hover:bg-[color:var(--accent)]",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted)] mb-1.5">
              Quando foi criada
            </p>
            <div className="space-y-0.5">
              {CREATED.map((c) => {
                const isActive = createdBucket === c.k;
                return (
                  <button
                    key={c.k}
                    type="button"
                    onClick={() => onCreatedBucket(c.k)}
                    className={cn(
                      "w-full flex items-center justify-between text-[13px] px-2.5 py-1.5 rounded-lg transition",
                      isActive
                        ? "bg-[color:var(--accent)] text-[color:var(--foreground)] font-medium"
                        : "text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]/60",
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      {isActive ? (
                        <Check size={14} />
                      ) : (
                        <span className="w-3.5" />
                      )}
                      {c.label}
                    </span>
                    {createdCounts[c.k] > 0 && (
                      <span className="text-[11px] text-[color:var(--muted)]">
                        {createdCounts[c.k]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

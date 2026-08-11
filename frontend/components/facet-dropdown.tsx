"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Opt = { value: string; label: string; count: number };
export type OrderOpt<K extends string = string> = { k: K; label: string };

// Dropdown multiselect compacto com contagem — reutilizado no picker de tarefas
// e na visão de tarefas do quadro.
export function FacetDropdown<K extends string = string>({
  label,
  options,
  selected,
  onToggle,
  onClear,
  searchable,
  wide,
  order,
}: {
  label: string;
  options: Opt[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  /** Habilita "limpar" dentro do painel (e o × no rótulo do botão). */
  onClear?: () => void;
  /** Busca dentro da lista — para facetas com muitas opções (reunião, pessoa). */
  searchable?: boolean;
  /** Painel largo: rótulos longos (nome de reunião) não cabem em 224px. */
  wide?: boolean;
  /** Escolha de ordem da lista (ex.: por data × por quantidade). */
  order?: { options: OrderOpt<K>[]; value: K; onChange: (k: K) => void };
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    // Esc fecha só o dropdown — sem isso o modal inteiro fechava junto.
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

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => o.label.toLowerCase().includes(s));
  }, [options, q]);

  const n = selected.size;
  // Mostra QUAL está escolhida — "Reunião · 1" não dizia nada sobre qual
  // reunião estava sendo puxada.
  const escolhida = n === 1 ? options.find((o) => selected.has(o.value))?.label : undefined;
  const textoBotao = n === 0 ? label : n === 1 ? (escolhida ?? label) : `${label}: ${n}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={n === 1 ? escolhida : undefined}
        className={cn(
          "inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-full border transition max-w-[260px]",
          n > 0
            ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)]"
            : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
        )}
      >
        <span className="truncate">{textoBotao}</span>
        {n > 0 && onClear ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Limpar filtro ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onClear();
              }
            }}
            className="shrink-0 -mr-0.5 p-0.5 rounded-full hover:bg-[color:var(--background)]/25 cursor-pointer"
          >
            <X size={12} />
          </span>
        ) : (
          <ChevronDown size={12} className={cn("shrink-0 transition", open && "rotate-180")} />
        )}
      </button>
      {open && (
        <div
          className={cn(
            "absolute z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-1.5",
            wide ? "w-[min(24rem,calc(100vw-2rem))]" : "w-56",
          )}
        >
          {(order || (searchable && options.length > 6)) && (
            <div className="px-1 pb-1.5 mb-1 border-b border-[color:var(--border)] space-y-1.5">
              {searchable && options.length > 6 && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[color:var(--border)]">
                  <Search size={12} className="text-[color:var(--muted-strong)] shrink-0" />
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="buscar…"
                    className="flex-1 min-w-0 bg-transparent text-[12px] outline-none placeholder:text-[color:var(--muted-strong)]"
                  />
                </div>
              )}
              {order && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] mr-0.5">
                    ver por
                  </span>
                  {order.options.map((o) => (
                    <button
                      key={o.k}
                      type="button"
                      onClick={() => order.onChange(o.k)}
                      className={cn(
                        "text-[11px] px-2 py-0.5 rounded-full border transition",
                        order.value === o.k
                          ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)]"
                          : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="text-[12px] text-[color:var(--muted)] px-2 py-2">
              {options.length === 0 ? "nada aqui" : "nada com esse texto"}
            </p>
          ) : (
            shown.map((o) => {
              const on = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onToggle(o.value)}
                  title={o.label}
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
                  <span className="text-[11px] text-[color:var(--muted)] tabular-nums">{o.count}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

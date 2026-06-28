"use client";

import { X } from "lucide-react";

export type ActiveChip = { id: string; label: string; onRemove: () => void };

// Faixa de filtros ativos — só aparece quando há algo aplicado.
export function ActiveFilters({
  chips,
  onClearAll,
}: {
  chips: ActiveChip[];
  onClearAll: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex items-center flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center gap-1 text-[12px] pl-2 pr-1 py-0.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
        >
          {c.label}
          <button
            type="button"
            onClick={c.onRemove}
            aria-label={`Remover filtro ${c.label}`}
            className="p-0.5 rounded-full text-[color:var(--muted)] hover:text-[color:var(--urgent)] hover:bg-[color:var(--urgent)]/10"
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-[12px] px-1.5 py-0.5 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
        >
          limpar tudo
        </button>
      )}
    </div>
  );
}

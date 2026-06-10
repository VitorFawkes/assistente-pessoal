"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tarefa } from "./task-row";

// Picker pra ESCOLHER quais tarefas entram no plano de ação (opt-in).
// Lista tarefas abertas que ainda não estão no plano; marca no_plano = true nas escolhidas.
export function PlanoAddModal({
  candidatos,
  onClose,
}: {
  candidatos: Tarefa[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term
      ? candidatos.filter((t) => t.titulo.toLowerCase().includes(term))
      : candidatos;
  }, [candidatos, q]);

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function add() {
    if (sel.size === 0) {
      onClose();
      return;
    }
    startTransition(async () => {
      await Promise.all(
        [...sel].map((id) =>
          fetch(`/api/tarefas/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ no_plano: true }),
          }),
        ),
      );
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-[color:var(--card)] border border-[color:var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Adicionar ao plano</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative mb-3">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar tarefa…"
            autoFocus
            className="w-full pl-9 pr-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1">
          {list.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted)] py-8 text-center">
              {candidatos.length === 0
                ? "Todas as tarefas abertas já estão no plano."
                : "Nada encontrado."}
            </p>
          ) : (
            list.map((t) => {
              const on = sel.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  className={cn(
                    "w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg border transition cursor-pointer",
                    on
                      ? "border-[color:var(--foreground)] bg-[color:var(--accent)]"
                      : "border-[color:var(--border)] hover:bg-[color:var(--accent)]/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center",
                      on
                        ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
                        : "border-[color:var(--muted)]",
                    )}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-snug">{t.titulo}</span>
                    <span className="block text-[11px] text-[color:var(--muted)] truncate">
                      {t.frente || t.frente_proposta || "sem área"}
                      {t.prazo ? " · com prazo" : " · sem data"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 mt-2 border-t border-[color:var(--border)]">
          <span className="text-[12px] text-[color:var(--muted)]">
            {sel.size} selecionada{sel.size === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={add}
              disabled={isPending || sel.size === 0}
              className="text-xs px-3 py-1.5 rounded bg-[color:var(--foreground)] text-[color:var(--background)] hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Plus size={13} strokeWidth={2.5} />
              {isPending ? "Adicionando…" : `Adicionar${sel.size ? ` ${sel.size}` : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

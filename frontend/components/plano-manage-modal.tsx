"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Check, Search } from "lucide-react";
import { cn, formatCreatedAt } from "@/lib/utils";
import type { Tarefa } from "@/lib/queries";

function isOpen(t: Tarefa) {
  return t.status !== "concluida" && t.status !== "cancelada";
}

// Gerencia quais tarefas estão no plano (opt-in): marca = no plano, desmarca = fora.
// Permite adicionar/remover VÁRIAS de uma vez, inclusive "todas de uma reunião"
// (filtra por reunião + "marcar/desmarcar todas"). Salva só o que mudou.
export function PlanoManageModal({
  tarefas,
  onClose,
}: {
  tarefas: Tarefa[];
  onClose: () => void;
}) {
  const router = useRouter();

  // gerenciáveis: abertas + as que já estão no plano (mesmo concluídas, pra poder tirar)
  const itens = useMemo(
    () => tarefas.filter((t) => isOpen(t) || t.no_plano),
    [tarefas],
  );
  const orig = useMemo(
    () => new Set(itens.filter((t) => t.no_plano).map((t) => t.id)),
    [itens],
  );

  const [sel, setSel] = useState<Set<string>>(() => new Set(orig));
  const [q, setQ] = useState("");
  const [meetingFilter, setMeetingFilter] = useState<string>("all");
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

  const meetings = useMemo(() => {
    const m = new Map<string, { id: string; label: string; count: number }>();
    for (const t of itens) {
      const key = t.meeting_id ?? "__none__";
      const label = t.meeting_id
        ? t.meeting_summary?.trim()?.slice(0, 50) ||
          (t.meeting_recorded_at ? `Reunião · ${formatCreatedAt(t.meeting_recorded_at)}` : "Reunião")
        : "Sem reunião (manuais)";
      const ex = m.get(key);
      if (ex) ex.count++;
      else m.set(key, { id: key, label, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [itens]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return itens.filter((t) => {
      if (meetingFilter !== "all" && (t.meeting_id ?? "__none__") !== meetingFilter)
        return false;
      if (term && !t.titulo.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [itens, q, meetingFilter]);

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const allFilteredChecked = list.length > 0 && list.every((t) => sel.has(t.id));
  function toggleAllFiltered() {
    setSel((s) => {
      const n = new Set(s);
      if (allFilteredChecked) list.forEach((t) => n.delete(t.id));
      else list.forEach((t) => n.add(t.id));
      return n;
    });
  }

  const toAdd = [...sel].filter((id) => !orig.has(id));
  const toRemove = [...orig].filter((id) => !sel.has(id));
  const changes = toAdd.length + toRemove.length;

  function save() {
    if (changes === 0) {
      onClose();
      return;
    }
    startTransition(async () => {
      await Promise.all([
        ...toAdd.map((id) =>
          fetch(`/api/tarefas/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ no_plano: true }),
          }),
        ),
        ...toRemove.map((id) =>
          fetch(`/api/tarefas/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ no_plano: false }),
          }),
        ),
      ]);
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
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Tarefas do plano</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <p className="text-[12px] text-[color:var(--muted)] mb-3">
          Marque pra colocar na linha do tempo, desmarque pra tirar.
        </p>

        {meetings.length > 1 && (
          <select
            value={meetingFilter}
            onChange={(e) => setMeetingFilter(e.target.value)}
            className="w-full mb-2 px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            <option value="all">Todas as reuniões ({itens.length})</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.count})
              </option>
            ))}
          </select>
        )}

        <div className="relative mb-2">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar tarefa…"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-[color:var(--muted)]">
            {list.length} tarefa{list.length === 1 ? "" : "s"}
            {meetingFilter !== "all" ? " nesta reunião" : ""}
          </span>
          {list.length > 0 && (
            <button
              type="button"
              onClick={toggleAllFiltered}
              className="text-[12px] font-medium text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] underline decoration-dotted underline-offset-2 cursor-pointer"
            >
              {allFilteredChecked ? "Desmarcar todas" : "Marcar todas"}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1">
          {list.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted)] py-8 text-center">
              Nenhuma tarefa aqui.
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
                      {t.meeting_id
                        ? t.meeting_summary?.trim()?.slice(0, 38) || "reunião"
                        : t.frente || t.frente_proposta || "manual"}
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
            {sel.size} no plano
            {changes > 0 && (
              <span className="ml-1.5 text-[color:var(--muted-strong)]">
                ({toAdd.length > 0 ? `+${toAdd.length}` : ""}
                {toAdd.length > 0 && toRemove.length > 0 ? " " : ""}
                {toRemove.length > 0 ? `−${toRemove.length}` : ""})
              </span>
            )}
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
              onClick={save}
              disabled={isPending || changes === 0}
              className="text-xs px-3 py-1.5 rounded bg-[color:var(--foreground)] text-[color:var(--background)] hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

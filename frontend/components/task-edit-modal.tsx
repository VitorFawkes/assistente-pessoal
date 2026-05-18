"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Trash2, Calendar } from "lucide-react";
import { cn, type Prioridade } from "@/lib/utils";
import type { Tarefa } from "./task-row";

type Props = {
  tarefa: Tarefa;
  onClose: () => void;
};

const PRIORIDADES: Prioridade[] = ["baixa", "media", "alta", "urgente"];
const STATUSES: Tarefa["status"][] = ["aberta", "em_andamento", "concluida", "cancelada"];

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  // Take the YYYY-MM-DD portion in local time (so the picker shows what user expects)
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateInputToIso(value: string): string | null {
  if (!value) return null;
  // Interpret as end-of-day local time so a "deadline today" still counts today
  const [y, m, d] = value.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d, 23, 59, 0, 0);
  return date.toISOString();
}

function nextWeekday(targetDay: number): Date {
  // targetDay: 0=sun..6=sat
  const d = new Date();
  const cur = d.getDay();
  const delta = (targetDay - cur + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export function TaskEditModal({ tarefa, onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [titulo, setTitulo] = useState(tarefa.titulo);
  const [descricao, setDescricao] = useState(tarefa.descricao ?? "");
  const [owner, setOwner] = useState(tarefa.owner);
  const [prazo, setPrazo] = useState(toDateInput(tarefa.prazo));
  const [prazoText, setPrazoText] = useState(tarefa.prazo_text ?? "");
  const [prioridade, setPrioridade] = useState<Prioridade>(tarefa.prioridade);
  const [status, setStatus] = useState<Tarefa["status"]>(tarefa.status);

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

  function setQuickPrazo(when: "hoje" | "amanha" | "sexta" | "proxsemana") {
    let date: Date;
    if (when === "hoje") {
      date = new Date();
    } else if (when === "amanha") {
      date = new Date();
      date.setDate(date.getDate() + 1);
    } else if (when === "sexta") {
      date = nextWeekday(5); // 5 = sexta
    } else {
      // próxima semana = próxima segunda
      date = nextWeekday(1);
    }
    setPrazo(toDateInput(date.toISOString()));
  }

  async function handleSave() {
    setError(null);
    if (!titulo.trim()) {
      setError("título não pode ficar vazio");
      return;
    }
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {
          titulo: titulo.trim(),
          descricao: descricao.trim() || null,
          owner: owner.trim() || "vitor",
          prazo: dateInputToIso(prazo),
          prazo_text: prazoText.trim() || null,
          prioridade,
          status,
        };
        const r = await fetch(`/api/tarefas/${tarefa.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `erro ${r.status}`);
          return;
        }
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/tarefas/${tarefa.id}`, { method: "DELETE" });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `erro ${r.status}`);
          return;
        }
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-[color:var(--card)] border border-[color:var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Editar tarefa</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Título
            </label>
            <input
              type="text"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Descrição
            </label>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
                Responsável
              </label>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="vitor"
                className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
                Prioridade
              </label>
              <select
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value as Prioridade)}
                className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              <Calendar size={12} className="inline mr-1 -mt-0.5" />
              Prazo
            </label>
            <input
              type="date"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                { k: "hoje", label: "Hoje" },
                { k: "amanha", label: "Amanhã" },
                { k: "sexta", label: "Sexta" },
                { k: "proxsemana", label: "Próx semana" },
              ].map((opt) => (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => setQuickPrazo(opt.k as "hoje" | "amanha" | "sexta" | "proxsemana")}
                  className="text-xs px-2 py-1 rounded border border-[color:var(--border)] hover:bg-[color:var(--accent)] transition"
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPrazo("")}
                className="text-xs px-2 py-1 rounded border border-dashed border-[color:var(--border)] hover:bg-[color:var(--accent)] transition text-[color:var(--muted)]"
              >
                limpar
              </button>
            </div>
            {tarefa.prazo_text && (
              <p className="text-[11px] text-[color:var(--muted)] mt-1">
                Texto original do prazo: &ldquo;{tarefa.prazo_text}&rdquo;
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Tarefa["status"])}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isPending}
                  className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isPending ? "Deletando..." : "Confirmar delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={isPending}
                  className="text-xs px-3 py-1.5 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                >
                  cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={isPending}
                className="text-xs px-3 py-1.5 rounded border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-1"
              >
                <Trash2 size={12} /> Deletar
              </button>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="text-xs px-3 py-1.5 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className={cn(
                  "text-xs px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 disabled:opacity-50",
                )}
              >
                {isPending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

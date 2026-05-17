"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, ExternalLink, AlertCircle, Clock } from "lucide-react";
import { cn, prioridadeBadge, formatPrazo, formatPrazoColor, type Prioridade } from "@/lib/utils";

export type Tarefa = {
  id: string;
  meeting_id: string | null;
  titulo: string;
  descricao: string | null;
  owner: string;
  is_mine: boolean;
  prazo: string | null;
  prazo_text: string | null;
  prioridade: Prioridade;
  status: "aberta" | "em_andamento" | "concluida" | "cancelada";
  evidencia: string | null;
  created_at: string;
  meeting_recorded_at?: string | null;
  meeting_summary?: string | null;
};

export function TaskRow({ tarefa }: { tarefa: Tarefa }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);

  const pr = prioridadeBadge(tarefa.prioridade);
  const prazo = formatPrazo(tarefa.prazo);
  const prazoCls = formatPrazoColor(prazo.status);
  const isDone = tarefa.status === "concluida";
  const isOverdue = prazo.status === "vencida";

  function toggleDone() {
    startTransition(async () => {
      const next = isDone ? "aberta" : "concluida";
      await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "group flex flex-col rounded-lg border bg-[color:var(--card)] transition",
        isDone ? "opacity-50 border-[color:var(--border)]" : "border-[color:var(--border)] hover:border-zinc-300 dark:hover:border-zinc-700",
        isOverdue && !isDone && "border-red-200 dark:border-red-900/40",
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={toggleDone}
          disabled={isPending}
          className={cn(
            "mt-0.5 shrink-0 transition",
            isDone ? "text-emerald-500" : "text-zinc-400 hover:text-emerald-500",
          )}
          aria-label={isDone ? "Reabrir tarefa" : "Marcar como concluída"}
        >
          {isDone ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        </button>

        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-left w-full"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", pr.dot)} aria-hidden />
              <p className={cn("text-sm font-medium", isDone && "line-through")}>
                {tarefa.titulo}
              </p>
              {!tarefa.is_mine && (
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                  → {tarefa.owner}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-[color:var(--muted)]">
              <span className={cn("flex items-center gap-1", prazoCls)}>
                {isOverdue ? <AlertCircle size={12} /> : <Clock size={12} />}
                {prazo.text}
                {tarefa.prazo_text && tarefa.prazo_text !== prazo.text && (
                  <span className="text-zinc-400">· "{tarefa.prazo_text}"</span>
                )}
              </span>
              {tarefa.meeting_id && (
                <Link
                  href={`/reunioes/${tarefa.meeting_id}`}
                  className="flex items-center gap-1 hover:text-[color:var(--foreground)]"
                >
                  <ExternalLink size={12} /> reunião
                </Link>
              )}
            </div>
          </button>

          {expanded && (
            <div className="mt-3 space-y-2 text-sm">
              {tarefa.descricao && (
                <p className="text-[color:var(--foreground)]">{tarefa.descricao}</p>
              )}
              {tarefa.evidencia && (
                <blockquote className="text-xs italic text-[color:var(--muted)] border-l-2 border-zinc-300 dark:border-zinc-700 pl-3">
                  "{tarefa.evidencia}"
                </blockquote>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

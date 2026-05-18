"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  ChevronRight,
  CalendarClock,
  Mic,
  AlertCircle,
  UserRound,
  Send,
  Flame,
} from "lucide-react";
import { cn, formatPrazo, type Prioridade } from "@/lib/utils";
import { TaskEditModal } from "./task-edit-modal";

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

// Faixa colorida na lateral esquerda — prioridade.
function priorityStripe(p: Prioridade): string {
  switch (p) {
    case "urgente":
      return "bg-[color:var(--urgent)]";
    case "alta":
      return "bg-[color:var(--warm)]";
    case "media":
      return "bg-[color:var(--muted)] opacity-30";
    case "baixa":
      return "bg-[color:var(--muted)] opacity-15";
  }
}

function prazoChipColor(
  status: ReturnType<typeof formatPrazo>["status"],
): string {
  switch (status) {
    case "vencida":
      return "text-[color:var(--urgent)] bg-[color:var(--urgent-bg)]";
    case "hoje":
      return "text-[color:var(--warm)] bg-[color:var(--warm-bg)]";
    case "amanha":
      return "text-[color:var(--warm)] bg-[color:var(--warm-bg)] opacity-90";
    case "futuro":
      return "text-[color:var(--muted-strong)] bg-[color:var(--accent)]";
    default:
      return "text-[color:var(--muted)] bg-transparent border border-[color:var(--border)] border-dashed";
  }
}

// Chip claro de "quem faz" — Minha vs Aguardando.
function OwnerChip({ tarefa }: { tarefa: Tarefa }) {
  if (tarefa.is_mine) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] font-medium">
        <UserRound size={11} strokeWidth={2} />
        minha
      </span>
    );
  }
  const label =
    tarefa.owner === "?" ? "aguardando alguém" : `aguardando ${tarefa.owner}`;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] font-medium">
      <Send size={11} strokeWidth={2} />
      {label}
    </span>
  );
}

export function TaskRow({ tarefa }: { tarefa: Tarefa }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const prazo = formatPrazo(tarefa.prazo);
  const isDone = tarefa.status === "concluida";
  const isCancelled = tarefa.status === "cancelada";
  const isOverdue = prazo.status === "vencida";
  const isUrgent = tarefa.prioridade === "urgente";

  function toggleDone(e: React.MouseEvent) {
    e.stopPropagation();
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
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={cn(
          "press-feedback group relative flex items-stretch gap-0 paper-card rounded-2xl border overflow-hidden cursor-pointer",
          "border-[color:var(--border)] hover:border-[color:var(--muted)]",
          (isDone || isCancelled) && "opacity-55",
          // Vencida grita: borda terracota grossa + ring + bg sutil
          isOverdue && !isDone &&
            "border-[color:var(--urgent)]/60 ring-1 ring-[color:var(--urgent)]/30 shadow-[0_1px_8px_-2px_rgb(199_100_77_/_0.15)]",
        )}
      >
        {/* faixa de prioridade na lateral */}
        <div
          className={cn("w-1.5 shrink-0", priorityStripe(tarefa.prioridade))}
          aria-hidden
        />

        {/* botão de status (toggle done) — área de toque grande */}
        <button
          type="button"
          onClick={toggleDone}
          disabled={isPending}
          aria-label={isDone ? "Reabrir tarefa" : "Marcar como concluída"}
          className={cn(
            "shrink-0 flex items-center justify-center w-14 -ml-px touch-manipulation",
            "text-[color:var(--muted)] hover:text-[color:var(--calm)] active:text-[color:var(--calm)]",
            isDone && "text-[color:var(--calm)]",
          )}
        >
          {isDone ? (
            <CheckCircle2 size={22} strokeWidth={2} />
          ) : (
            <Circle size={22} strokeWidth={1.75} />
          )}
        </button>

        {/* conteúdo da tarefa */}
        <div className="flex-1 min-w-0 py-3.5 pr-3 sm:pr-4">
          {/* Linha de chips no topo: status (vencida/urgente) + owner */}
          <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
            {isOverdue && !isDone && (
              <span className="inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase font-bold px-2 py-0.5 rounded-full bg-[color:var(--urgent)] text-white">
                <AlertCircle size={10} strokeWidth={2.5} />
                vencida
              </span>
            )}
            {isUrgent && !isOverdue && !isDone && (
              <span className="inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase font-bold px-2 py-0.5 rounded-full bg-[color:var(--urgent)]/15 text-[color:var(--urgent)]">
                <Flame size={10} strokeWidth={2.5} />
                urgente
              </span>
            )}
            <OwnerChip tarefa={tarefa} />
          </div>

          <p
            className={cn(
              "text-[15px] leading-snug text-[color:var(--foreground)]",
              isDone && "line-through",
            )}
          >
            {tarefa.titulo}
          </p>

          {/* Linha de metadata: prazo + link reunião */}
          <div className="mt-2 flex items-center flex-wrap gap-x-2 gap-y-1">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full",
                prazoChipColor(prazo.status),
              )}
            >
              <CalendarClock size={11} />
              {prazo.text}
            </span>
            {tarefa.prazo_text && tarefa.prazo_text !== prazo.text && (
              <span className="text-[11px] text-[color:var(--muted)] italic">
                &ldquo;{tarefa.prazo_text}&rdquo;
              </span>
            )}
            {tarefa.meeting_id && (
              <Link
                href={`/reunioes/${tarefa.meeting_id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
              >
                <Mic size={11} />
                reunião
              </Link>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center pr-3 sm:pr-4 text-[color:var(--muted)] group-hover:text-[color:var(--foreground)] transition">
          <ChevronRight size={18} strokeWidth={1.75} />
        </div>
      </div>

      {editing && (
        <TaskEditModal tarefa={tarefa} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

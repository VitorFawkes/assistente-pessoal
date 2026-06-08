"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  ChevronRight,
  CalendarClock,
  CalendarPlus,
  Mic,
  AlertCircle,
  UserRound,
  Send,
  Bell,
  Flame,
  Trash2,
  Tag,
  Users,
  Quote,
  ChevronDown,
} from "lucide-react";
import { cn, formatPrazo, formatCreatedAt, fmtDate, type Prioridade } from "@/lib/utils";
import { TaskEditModal } from "./task-edit-modal";

export type Acao = "executar" | "cobrar" | "aguardar";

export type Tarefa = {
  id: string;
  meeting_id: string | null;
  titulo: string;
  descricao: string | null;
  owner: string;
  is_mine: boolean;
  acao: Acao;
  prazo: string | null;
  prazo_text: string | null;
  prioridade: Prioridade;
  status: "aberta" | "em_andamento" | "concluida" | "cancelada";
  evidencia: string | null;
  frente: string | null;
  frente_proposta: string | null;
  pessoas: { id: string; nome: string; principal: boolean }[];
  created_at: string;
  precisa_revisao: boolean;
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

// Input inline pra editar o nome do owner sem abrir modal.
function OwnerInput({
  initial,
  onSave,
  onCancel,
  className,
}: {
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(
    initial === "?" || !initial ? "" : initial,
  );
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  function commit() {
    const trimmed = value.trim();
    onSave(trimmed || "?");
  }
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={commit}
      placeholder="nome"
      className={cn(
        "text-[11px] tracking-wide px-1.5 py-0 rounded bg-transparent outline-none ring-1 ring-[color:var(--foreground)]/40 focus:ring-[color:var(--foreground)] min-w-[80px] max-w-[140px]",
        className,
      )}
    />
  );
}

// Chip mostrando ação + owner. Owner clicável → editável inline (exceto executar).
function AcaoChip({
  tarefa,
  editingOwner,
  onStartEdit,
  onSaveOwner,
  onCancelEdit,
}: {
  tarefa: Tarefa;
  editingOwner: boolean;
  onStartEdit: () => void;
  onSaveOwner: (value: string) => void;
  onCancelEdit: () => void;
}) {
  if (tarefa.acao === "executar") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] font-medium">
        <UserRound size={11} strokeWidth={2} />
        minha
      </span>
    );
  }
  const ownerLabel =
    !tarefa.owner || tarefa.owner === "?" || tarefa.owner.trim() === ""
      ? "alguém"
      : tarefa.owner;
  const isCobrar = tarefa.acao === "cobrar";
  const wrapperClass = isCobrar
    ? "inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] font-semibold ring-1 ring-[color:var(--warm)]/30"
    : "inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--warm-bg)]/60 text-[color:var(--warm)] font-medium";
  const verb = isCobrar ? "cobrar" : "aguardando";
  return (
    <span className={wrapperClass}>
      {isCobrar ? (
        <Bell size={11} strokeWidth={2} />
      ) : (
        <Send size={11} strokeWidth={2} />
      )}
      <span>{verb}</span>
      {editingOwner ? (
        <OwnerInput
          initial={tarefa.owner}
          onSave={onSaveOwner}
          onCancel={onCancelEdit}
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit();
          }}
          className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
          title="Clique pra editar o nome"
        >
          {ownerLabel}
        </button>
      )}
    </span>
  );
}

// Toggle inline pra mudar acao em 1 clique.
function AcaoToggle({
  tarefa,
  onChange,
  disabled,
}: {
  tarefa: Tarefa;
  onChange: (next: Acao) => void;
  disabled: boolean;
}) {
  const opts: { value: Acao; label: string }[] = [
    { value: "executar", label: "executar" },
    { value: "cobrar", label: "cobrar" },
    { value: "aguardar", label: "aguardar" },
  ];
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-[color:var(--accent)]/40 p-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      {opts.map((o) => {
        const active = tarefa.acao === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled || active}
            onClick={() => onChange(o.value)}
            className={cn(
              "text-[10px] tracking-wide px-1.5 py-0.5 rounded-full transition",
              active
                ? "bg-[color:var(--foreground)] text-[color:var(--background)] font-semibold"
                : "text-[color:var(--muted)] hover:text-[color:var(--foreground)]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

export function TaskRow({ tarefa }: { tarefa: Tarefa }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [editingOwner, setEditingOwner] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEvidencia, setShowEvidencia] = useState(false);

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

  function changeAcao(next: Acao) {
    if (next === tarefa.acao) return;
    startTransition(async () => {
      await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: next }),
      });
      router.refresh();
    });
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      await fetch(`/api/tarefas/${tarefa.id}`, { method: "DELETE" });
      router.refresh();
    });
  }

  function cancelDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmDelete(false);
  }

  function saveOwner(next: string) {
    setEditingOwner(false);
    if (next === tarefa.owner) return;
    startTransition(async () => {
      await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: next }),
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
          {/* Linha de chips no topo: status (vencida/urgente) + ação */}
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
            {tarefa.precisa_revisao && (
              <span title="IA com baixa confiança — confira prazo / pessoa / área"
                className="inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase font-bold px-2 py-0.5 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] border border-[color:var(--warm)]/40">
                revisar
              </span>
            )}
            <AcaoChip
              tarefa={tarefa}
              editingOwner={editingOwner}
              onStartEdit={() => setEditingOwner(true)}
              onSaveOwner={saveOwner}
              onCancelEdit={() => setEditingOwner(false)}
            />
            {!isDone && !isCancelled && (
              <AcaoToggle
                tarefa={tarefa}
                onChange={changeAcao}
                disabled={isPending}
              />
            )}
            {tarefa.frente && (
              <span className="inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)]">
                <Tag size={11} strokeWidth={2} />
                {tarefa.frente}
              </span>
            )}
            {!tarefa.frente && tarefa.frente_proposta && (
              <span
                className="inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] border border-dashed border-[color:var(--warm)]/40"
                title="Área sugerida pela IA — aprovar na edição (em breve)"
              >
                <Tag size={11} strokeWidth={2} />
                {tarefa.frente_proposta}?
              </span>
            )}
            {(tarefa.pessoas ?? [])
              .filter((p) => !p.principal)
              .map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--accent)]/60 text-[color:var(--muted-strong)]"
                >
                  <Users size={11} strokeWidth={2} />
                  {p.nome}
                </span>
              ))}
          </div>

          <p
            className={cn(
              "text-[15px] leading-snug text-[color:var(--foreground)]",
              isDone && "line-through",
            )}
          >
            {tarefa.titulo}
          </p>

          {tarefa.descricao && (
            <p className="mt-1 text-[13px] leading-snug text-[color:var(--muted-strong)] line-clamp-2">
              {tarefa.descricao}
            </p>
          )}

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
                title={tarefa.meeting_summary ?? undefined}
                className="press-feedback inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] transition max-w-[280px]"
              >
                <Mic size={11} className="shrink-0" />
                <span className="truncate">
                  {tarefa.meeting_summary || "ver reunião"}
                </span>
              </Link>
            )}
            {(tarefa.meeting_recorded_at || tarefa.created_at) && (
              <span
                className="inline-flex items-center gap-1 text-[12px] text-[color:var(--muted)]"
                title={
                  tarefa.meeting_recorded_at
                    ? `Reunião em ${fmtDate(tarefa.meeting_recorded_at)}`
                    : `Tarefa criada em ${fmtDate(tarefa.created_at)}`
                }
              >
                <CalendarPlus size={11} />
                {formatCreatedAt(tarefa.meeting_recorded_at ?? tarefa.created_at)}
              </span>
            )}
            {tarefa.evidencia && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEvidencia((v) => !v);
                }}
                className="inline-flex items-center gap-1 text-[11px] text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
              >
                <Quote size={11} />
                trecho
                <ChevronDown
                  size={11}
                  className={cn("transition", showEvidencia && "rotate-180")}
                />
              </button>
            )}
          </div>

          {showEvidencia && tarefa.evidencia && (
            <p className="mt-2 text-[12px] italic text-[color:var(--muted)] border-l-2 border-[color:var(--border)] pl-3">
              &ldquo;{tarefa.evidencia}&rdquo;
            </p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1 pr-2 sm:pr-3 text-[color:var(--muted)]">
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                aria-label="Confirmar deletar"
                className="text-[10px] tracking-[0.1em] uppercase font-bold px-2 py-1 rounded-full bg-[color:var(--urgent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "..." : "deletar"}
              </button>
              <button
                type="button"
                onClick={cancelDelete}
                disabled={isPending}
                aria-label="Cancelar"
                className="text-[11px] px-1.5 py-1 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
              >
                ✕
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                aria-label="Deletar tarefa"
                className="p-1.5 rounded-full text-[color:var(--muted)] hover:bg-[color:var(--urgent)]/10 hover:text-[color:var(--urgent)] transition"
              >
                <Trash2 size={15} strokeWidth={1.75} />
              </button>
              <ChevronRight
                size={18}
                strokeWidth={1.75}
                className="group-hover:text-[color:var(--foreground)] transition"
              />
            </>
          )}
        </div>
      </div>

      {editing && (
        <TaskEditModal tarefa={tarefa} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

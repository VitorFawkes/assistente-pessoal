"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  ChevronRight,
  CalendarClock,
  Mic,
  UserRound,
  Send,
  Bell,
  Flame,
  Trash2,
  Quote,
  ChevronDown,
  Check,
  Dot,
} from "lucide-react";
import { cn, formatPrazo, normalizeOwner, type Prioridade } from "@/lib/utils";
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
  inicio: string | null;
  prazo_text: string | null;
  prioridade: Prioridade;
  status: "aberta" | "em_andamento" | "concluida" | "cancelada";
  evidencia: string | null;
  frente: string | null;
  frente_proposta: string | null;
  pessoas: { id: string; nome: string; principal: boolean }[];
  created_at: string;
  updated_at?: string | null;
  precisa_revisao: boolean;
  ordem: number | null;
  no_plano: boolean;
  meeting_recorded_at?: string | null;
  meeting_summary?: string | null;
  meeting_type?: string | null;
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
// Chip de ação EDITÁVEL: clique abre popover (Eu faço / Eu cobro / Aguardar +
// responsável). Popover é `fixed` porque o card tem overflow-hidden (clipa absolute).
// Ao aplicar, PATCH {acao, owner} → o backend recalcula o `principal` (agrupamento).
function AcaoEditor({ tarefa }: { tarefa: Tarefa }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [draftAcao, setDraftAcao] = useState<Acao>(
    tarefa.acao === "executar" ? "cobrar" : tarefa.acao,
  );
  const ownerInicial =
    tarefa.owner && tarefa.owner !== "?" && tarefa.owner.toLowerCase() !== "vitor"
      ? tarefa.owner
      : "";
  const [owner, setOwner] = useState(ownerInicial);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        popRef.current?.contains(e.target as Node) ||
        btnRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
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

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      const W = 232;
      if (r)
        setPos({
          top: r.bottom + 6,
          left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
        });
      setDraftAcao(tarefa.acao === "executar" ? "cobrar" : tarefa.acao);
      setOwner(ownerInicial);
    }
    setOpen((v) => !v);
  }

  function apply(acao: Acao, ownerValue: string) {
    startTransition(async () => {
      await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao,
          owner: acao === "executar" ? "vitor" : ownerValue.trim() || "?",
        }),
      });
      setOpen(false);
      router.refresh();
    });
  }

  const isExec = tarefa.acao === "executar";
  const isCobrar = tarefa.acao === "cobrar";
  const ownerLabel = normalizeOwner(tarefa.owner);

  return (
    <span className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title="Trocar ação / responsável"
        className={cn(
          "inline-flex items-center gap-0.5 text-[10px] tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap cursor-pointer transition",
          isExec
            ? "bg-[color:var(--calm-bg)] text-[color:var(--calm)] font-medium hover:ring-1 hover:ring-[color:var(--calm)]/40"
            : isCobrar
            ? "bg-[color:var(--warm-bg)] text-[color:var(--warm)] font-semibold ring-1 ring-[color:var(--warm)]/30"
            : "bg-[color:var(--warm-bg)]/60 text-[color:var(--warm)] font-medium",
        )}
      >
        {isExec ? (
          <UserRound size={10} strokeWidth={2} />
        ) : isCobrar ? (
          <Bell size={10} strokeWidth={2} />
        ) : (
          <Send size={10} strokeWidth={2} />
        )}
        <span className="max-w-[110px] truncate">
          {isExec ? "minha" : `${isCobrar ? "cobrar" : "aguard."} ${ownerLabel}`}
        </span>
      </button>

      {open && pos && (
        <div
          ref={popRef}
          style={{ top: pos.top, left: pos.left, width: 232 }}
          className="fixed z-50 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-2.5 space-y-2"
        >
          <div className="flex flex-wrap gap-1">
            {(
              [
                { v: "executar", label: "Eu faço" },
                { v: "cobrar", label: "Eu cobro" },
                { v: "aguardar", label: "Aguardar" },
              ] as const
            ).map((o) => {
              const active =
                o.v === "executar" ? isExec : draftAcao === o.v && !isExec;
              return (
                <button
                  key={o.v}
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    o.v === "executar" ? apply("executar", "") : setDraftAcao(o.v)
                  }
                  className={cn(
                    "text-[12px] px-2 py-1 rounded-full border transition",
                    active
                      ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)] font-medium"
                      : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {draftAcao !== "executar" && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && owner.trim()) apply(draftAcao, owner);
                }}
                placeholder="responsável"
                autoFocus
                className="flex-1 min-w-0 px-2 py-1 rounded border border-[color:var(--border)] bg-transparent text-[12px] outline-none focus:border-[color:var(--muted)]"
              />
              <button
                type="button"
                disabled={isPending || !owner.trim()}
                onClick={() => apply(draftAcao, owner)}
                className="shrink-0 text-[12px] px-2.5 py-1 rounded bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-40"
              >
                ok
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

export function TaskRow({
  tarefa,
  selected = false,
  onToggleSelect,
  onFilterArea,
}: {
  tarefa: Tarefa;
  selected?: boolean;
  // Quando passado, mostra a checkbox de seleção em massa (sempre visível).
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  // Quando passado, clicar no chip de área filtra por ela (click-through).
  onFilterArea?: (area: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEvidencia, setShowEvidencia] = useState(false);

  const prazo = formatPrazo(tarefa.prazo);
  const isDone = tarefa.status === "concluida";
  const isCancelled = tarefa.status === "cancelada";
  const isOverdue = prazo.status === "vencida";
  const isUrgent = tarefa.prioridade === "urgente";

  const secondaryPeople = (tarefa.pessoas ?? []).filter((p) => !p.principal);

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

  // "não é tarefa": rejeição explícita — guarda exemplo negativo pro loop de feedback e remove.
  function handleReject(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      await fetch(`/api/tarefas/${tarefa.id}?motivo=nao_era_tarefa`, {
        method: "DELETE",
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
          "press-feedback group relative flex items-stretch gap-0 paper-card rounded-xl border overflow-hidden cursor-pointer",
          "border-[color:var(--border)] hover:border-[color:var(--muted)]",
          (isDone || isCancelled) && "opacity-55",
          // Vencida grita: borda terracota + ring sutil
          isOverdue && !isDone &&
            "border-[color:var(--urgent)]/60 ring-1 ring-[color:var(--urgent)]/30",
          // Selecionada pra ação em massa
          selected &&
            "border-[color:var(--foreground)] ring-2 ring-[color:var(--foreground)]/25 bg-[color:var(--accent)]/40 opacity-100",
        )}
      >
        {/* faixa de prioridade na lateral */}
        <div
          className={cn("w-1.5 shrink-0", priorityStripe(tarefa.prioridade))}
          aria-hidden
        />

        {/* checkbox de seleção em massa (quadrada, distinta do círculo de concluir) */}
        {onToggleSelect && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(tarefa.id, e);
            }}
            aria-label={selected ? "Desmarcar tarefa" : "Selecionar tarefa"}
            aria-pressed={selected}
            className="shrink-0 flex items-center justify-center w-8 touch-manipulation"
          >
            <span
              className={cn(
                "w-4 h-4 rounded-md border flex items-center justify-center transition",
                selected
                  ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
                  : "border-[color:var(--muted)]/60 text-transparent hover:border-[color:var(--muted-strong)]",
              )}
            >
              <Check size={11} strokeWidth={3} />
            </span>
          </button>
        )}

        {/* botão de status (toggle done) */}
        <button
          type="button"
          onClick={toggleDone}
          disabled={isPending}
          aria-label={isDone ? "Reabrir tarefa" : "Marcar como concluída"}
          className={cn(
            "shrink-0 flex items-center justify-center w-9 touch-manipulation",
            "text-[color:var(--muted)] hover:text-[color:var(--calm)] active:text-[color:var(--calm)]",
            isDone && "text-[color:var(--calm)]",
          )}
        >
          {isDone ? (
            <CheckCircle2 size={18} strokeWidth={2} />
          ) : (
            <Circle size={18} strokeWidth={1.75} />
          )}
        </button>

        {/* conteúdo da tarefa */}
        <div className="flex-1 min-w-0 py-2 pr-2 sm:pr-3">
          {/* Linha 1: título + prazo */}
          <div className="flex items-center gap-2 min-w-0">
            <p
              className={cn(
                "flex-1 min-w-0 truncate text-[14px] leading-snug text-[color:var(--foreground)] font-medium",
                isDone && "line-through",
              )}
            >
              {tarefa.titulo}
            </p>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap",
                prazoChipColor(prazo.status),
              )}
            >
              <CalendarClock size={10} />
              {prazo.text}
            </span>
          </div>

          {/* Linha 2: descrição (1 linha) + ação + indicadores (quebram se faltar espaço) */}
          <div className="mt-1 flex items-start gap-1.5 min-w-0">
            {tarefa.descricao ? (
              <p className="flex-1 min-w-0 text-[12px] leading-snug text-[color:var(--muted-strong)] line-clamp-1">
                {tarefa.descricao}
              </p>
            ) : (
              <span className="flex-1 min-w-0" />
            )}
            <div
              className="flex items-center flex-wrap justify-end gap-x-1 gap-y-1 min-w-0"
              onClick={(e) => e.stopPropagation()}
            >
              {isUrgent && !isOverdue && !isDone && (
                <Flame
                  size={12}
                  className="text-[color:var(--urgent)]"
                  strokeWidth={2.5}
                />
              )}
              {tarefa.precisa_revisao && (
                <span
                  title="IA com baixa confiança — confira prazo / pessoa / área"
                  className="inline-flex text-[color:var(--warm)]"
                >
                  <Dot size={14} strokeWidth={4} />
                </span>
              )}
              {secondaryPeople.length > 0 && (
                <span
                  className="text-[11px] text-[color:var(--muted-strong)] whitespace-nowrap"
                  title={secondaryPeople.map((p) => p.nome).join(", ")}
                >
                  +{secondaryPeople.length}
                </span>
              )}
              {tarefa.frente && (
                <button
                  type="button"
                  title={onFilterArea ? `Filtrar por ${tarefa.frente}` : tarefa.frente}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterArea?.(tarefa.frente!);
                  }}
                  className={cn(
                    "text-[11px] px-1.5 py-0.5 rounded bg-[color:var(--accent)] text-[color:var(--muted-strong)] whitespace-nowrap max-w-[100px] sm:max-w-[160px] truncate",
                    onFilterArea && "hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] transition cursor-pointer",
                  )}
                >
                  {tarefa.frente}
                </button>
              )}
              {!tarefa.frente && tarefa.frente_proposta && (
                <span
                  title={tarefa.frente_proposta ?? undefined}
                  className="text-[11px] px-1.5 py-0.5 rounded border border-dashed border-[color:var(--warm)]/40 text-[color:var(--warm)] whitespace-nowrap max-w-[100px] sm:max-w-[160px] truncate"
                >
                  {tarefa.frente_proposta}?
                </span>
              )}
              <AcaoEditor tarefa={tarefa} />
            </div>
          </div>

          {/* Linha 3 (só se existir): reunião + trecho */}
          {(tarefa.meeting_id || tarefa.evidencia) && (
            <div className="mt-1 flex items-center gap-2 text-[11px] min-w-0">
              {tarefa.meeting_id && (
                <Link
                  href={`/reunioes/${tarefa.meeting_id}`}
                  onClick={(e) => e.stopPropagation()}
                  title={tarefa.meeting_summary ?? undefined}
                  className="press-feedback inline-flex items-center gap-0.5 px-1.5 py-0 rounded bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] transition min-w-0"
                >
                  <Mic size={10} className="shrink-0" />
                  <span className="truncate max-w-[150px] sm:max-w-[240px]">
                    {tarefa.meeting_summary || "reunião"}
                  </span>
                </Link>
              )}
              {tarefa.evidencia && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowEvidencia((v) => !v);
                  }}
                  className="shrink-0 inline-flex items-center gap-0.5 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                >
                  <Quote size={10} />
                  trecho
                  <ChevronDown
                    size={10}
                    className={cn("transition", showEvidencia && "rotate-180")}
                  />
                </button>
              )}
            </div>
          )}

          {showEvidencia && tarefa.evidencia && (
            <p className="mt-1 text-[12px] italic text-[color:var(--muted)] border-l-2 border-[color:var(--border)] pl-3">
              &ldquo;{tarefa.evidencia}&rdquo;
            </p>
          )}
        </div>

        {/* ações à direita (delete) — discretas, aparecem no hover */}
        <div className="shrink-0 flex items-center gap-0.5 pr-1.5 sm:pr-2 text-[color:var(--muted)]">
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
                onClick={handleReject}
                disabled={isPending}
                aria-label="Não é tarefa"
                title="Não era tarefa — ensina o sistema a não extrair coisas assim"
                className="text-[10px] tracking-[0.1em] uppercase font-bold px-2 py-1 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] hover:opacity-90 disabled:opacity-50"
              >
                não é
              </button>
              <button
                type="button"
                onClick={cancelDelete}
                disabled={isPending}
                aria-label="Cancelar"
                className="text-[11px] px-1 py-1 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
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
                className="p-1 rounded-full text-[color:var(--muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[color:var(--urgent)]/10 hover:text-[color:var(--urgent)] transition"
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </button>
              <ChevronRight
                size={16}
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

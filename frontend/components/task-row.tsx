"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  Mic,
  Flame,
  Trash2,
  Quote,
  Check,
  Dot,
  Paperclip,
  Users,
} from "lucide-react";
import { cn, formatPrazo, normalizeOwner, type Prioridade } from "@/lib/utils";
import { meetingDateShort, meetingSubject } from "@/lib/meeting-label";
import { TaskExpandFields } from "./task-expand-fields";
import {
  PrazoInline,
  PrioridadeInline,
  AreaInline,
  AcaoInline,
  SituacaoInline,
} from "./inline-edit-chips";
import { useTaskMutations } from "@/lib/task-mutations";
import type { Tarefa, Acao } from "@/lib/queries";

export type { Tarefa, Acao };

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

// Título editável no próprio card: clique → input; Enter/blur salva, Esc cancela.
function TitleInline({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tarefa.titulo);
  const ref = useRef<HTMLInputElement>(null);
  const isDone = tarefa.status === "concluida";

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  function save() {
    setEditing(false);
    const v = value.trim();
    if (v && v !== tarefa.titulo) mut.patch(tarefa.id, { titulo: v });
    else setValue(tarefa.titulo);
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setValue(tarefa.titulo);
            setEditing(false);
          }
        }}
        className="flex-1 min-w-0 text-[14px] font-medium bg-transparent outline-none ring-1 ring-[color:var(--foreground)]/30 focus:ring-[color:var(--foreground)] rounded px-1 -mx-1 py-0.5"
      />
    );
  }

  return (
    <p
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="Clique pra editar o título"
      className={cn(
        // 2 linhas no celular: com 1 linha só, o prazo comia a largura e o
        // título virava "Finalizar o flu…" — a lista ficava ilegível no telefone.
        "flex-1 min-w-0 line-clamp-2 sm:line-clamp-1 text-[14px] leading-snug text-[color:var(--foreground)] font-medium cursor-text rounded px-1 -mx-1 hover:bg-[color:var(--accent)]/50 transition",
        isDone && "line-through",
      )}
    >
      {tarefa.titulo}
    </p>
  );
}

export function TaskRow({
  tarefa,
  selected = false,
  onToggleSelect,
  noQuadro = false,
}: {
  tarefa: Tarefa;
  selected?: boolean;
  // Quando passado, mostra a checkbox de seleção em massa (sempre visível).
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  // Dentro de um quadro a linha muda: a situação (4 opções) entra no lugar da
  // prioridade. Pendências, Plano e Reuniões seguem com a linha de sempre.
  noQuadro?: boolean;
}) {
  const mut = useTaskMutations();
  const isOwner = mut.scope === "owner";
  const [isPending, setIsPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEvidencia, setShowEvidencia] = useState(false);

  const prazo = formatPrazo(tarefa.prazo);
  const isDone = tarefa.status === "concluida";
  const isCancelled = tarefa.status === "cancelada";
  const isOverdue = prazo.status === "vencida";
  const isUrgent = tarefa.prioridade === "urgente";
  // Quem mais está atrelado — tirando quem já aparece no chip de dono, pra não
  // repetir o mesmo nome duas vezes na mesma linha. Antes isso era só um "+2",
  // que obrigava a abrir a tarefa pra descobrir de quem se tratava.
  const donoNome = normalizeOwner(tarefa.owner).toLowerCase();
  const outrasPessoas = (tarefa.pessoas ?? []).filter(
    (p) => p.nome.trim().toLowerCase() !== donoNome,
  );
  const PESSOAS_VISIVEIS = 2;
  const pessoasOcultas = outrasPessoas.length - PESSOAS_VISIVEIS;
  // Com mais de uma pessoa na linha, nome inteiro estoura o espaço e a segunda
  // some no "…" — aí só o primeiro nome, como se fala. Salvo quando o primeiro
  // nome se repete ("Maria" e "Maria Rafa" virariam "Maria, Maria"): aí vale
  // mais o nome inteiro, mesmo cortado, do que dois nomes iguais na tela.
  const nomesVisiveis = (() => {
    const inteiros = outrasPessoas.slice(0, PESSOAS_VISIVEIS).map((p) => p.nome.trim());
    if (inteiros.length < 2) return inteiros;
    const curtos = inteiros.map((n) => n.split(/\s+/)[0]);
    const distintos = new Set(curtos.map((n) => n.toLowerCase())).size === curtos.length;
    return distintos ? curtos : inteiros;
  })();

  // Reseta a confirmação de delete ao expandir/recolher.
  useEffect(() => {
    setConfirmDelete(false);
  }, [expanded]);

  async function toggleDone(e: React.MouseEvent) {
    e.stopPropagation();
    if (isPending) return;
    setIsPending(true);
    try {
      await mut.patch(
        tarefa.id,
        { status: isDone ? "aberta" : "concluida" },
        { silent: true },
      );
    } finally {
      setIsPending(false);
    }
  }

  async function doDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (isPending) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsPending(true);
    try {
      await mut.remove(tarefa.id);
    } finally {
      setIsPending(false);
    }
  }

  function cancelDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmDelete(false);
  }

  // "não é tarefa": rejeição explícita (dono) — motivo vai na query, alimenta o feedback.
  async function doReject(e: React.MouseEvent) {
    e.stopPropagation();
    if (isPending) return;
    setIsPending(true);
    try {
      await mut.remove(tarefa.id, { motivo: "nao_era_tarefa" });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div
      data-scope={mut.scope}
      className={cn(
        "paper-card rounded-xl border overflow-hidden transition",
        "border-[color:var(--border)] hover:border-[color:var(--muted)]",
        (isDone || isCancelled) && "opacity-55",
        isOverdue &&
          !isDone &&
          "border-[color:var(--urgent)]/60 ring-1 ring-[color:var(--urgent)]/30",
        selected &&
          "border-[color:var(--foreground)] ring-2 ring-[color:var(--foreground)]/25 bg-[color:var(--accent)]/40 opacity-100",
        expanded && "ring-1 ring-[color:var(--foreground)]/15 border-[color:var(--muted)]",
      )}
    >
      {/* Linha compacta (cabeçalho clicável → expande/recolhe) */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? "Recolher tarefa" : "Expandir tarefa"}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="press-feedback group relative flex items-stretch gap-0 cursor-pointer"
      >
        {/* faixa de prioridade */}
        <div
          className={cn("w-1.5 shrink-0", priorityStripe(tarefa.prioridade))}
          aria-hidden
        />

        {/* checkbox de seleção em massa */}
        {onToggleSelect && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(tarefa.id, e);
            }}
            aria-label={selected ? "Desmarcar tarefa" : "Selecionar tarefa"}
            aria-pressed={selected}
            title="Selecionar (ações em massa)"
            className={cn(
              // Duas bolinhas iguais lado a lado escondiam qual delas conclui.
              // No mouse, a de seleção só aparece ao passar por cima; no
              // celular (sem hover) ela continua sempre visível.
              "shrink-0 flex items-center justify-center w-8 touch-manipulation transition-opacity",
              !selected &&
                "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
            )}
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

        {/* concluir (toggle status) */}
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

        {/* conteúdo */}
        <div className="flex-1 min-w-0 py-2 pr-2 sm:pr-3">
          {/* Linha 1: título (editável) + prazo (editável).
              No celular o prazo desce pra linha de baixo — disputando espaço
              com ele, o título sobrava com ~110px e ficava ilegível. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
            <div className="w-full sm:w-auto sm:flex-1 min-w-0 flex">
              <TitleInline tarefa={tarefa} />
            </div>
            <span className="shrink-0">
              <PrazoInline tarefa={tarefa} />
            </span>
          </div>

          {/* Linha 2: descrição + indicadores + chips editáveis */}
          {/* No celular a descrição perdia a disputa de espaço com os chips e
              sobrava um caractere solto — lá ela fica com a linha inteira e os
              chips descem. No desktop continuam lado a lado. */}
          <div className="mt-1 flex flex-wrap items-start gap-x-1.5 gap-y-1 min-w-0">
            {tarefa.descricao ? (
              <p className="w-full sm:w-auto sm:flex-1 min-w-0 text-[12px] leading-snug text-[color:var(--muted-strong)] line-clamp-1">
                {tarefa.descricao}
              </p>
            ) : (
              <span className="flex-1 min-w-0" />
            )}
            <div className="w-full sm:w-auto flex items-center flex-wrap justify-end gap-x-1 gap-y-1 min-w-0">
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
              {(tarefa.anexos?.length ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[11px] text-[color:var(--muted-strong)] whitespace-nowrap"
                  title={`${tarefa.anexos.length} anexo${tarefa.anexos.length !== 1 ? "s" : ""}`}
                >
                  <Paperclip size={11} strokeWidth={2} />
                  {tarefa.anexos.length}
                </span>
              )}
              <AreaInline tarefa={tarefa} />
              {/* No quadro a tarefa anda por situação (A fazer, Fazendo,
                  Aguardando aprovação, Feito) e a prioridade sai de cena —
                  decisão do Vitor em 20/08/2026. Nas outras telas fica igual. */}
              {noQuadro ? (
                <SituacaoInline tarefa={tarefa} />
              ) : (
                <PrioridadeInline tarefa={tarefa} />
              )}
              {outrasPessoas.length > 0 && (
                <span
                  title={`Também nesta tarefa: ${outrasPessoas.map((p) => p.nome).join(", ")}`}
                  className="inline-flex items-center gap-1 text-[10px] tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
                >
                  <Users size={10} strokeWidth={2} className="shrink-0" />
                  <span className="max-w-[170px] truncate">
                    {nomesVisiveis.join(", ")}
                  </span>
                  {pessoasOcultas > 0 && (
                    <span className="opacity-70">+{pessoasOcultas}</span>
                  )}
                </span>
              )}
              <AcaoInline tarefa={tarefa} />
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
                  className="press-feedback inline-flex items-center gap-1 px-1.5 py-0 rounded bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)] transition min-w-0"
                >
                  <Mic size={10} className="shrink-0" />
                  {meetingDateShort(tarefa.meeting_recorded_at) && (
                    <span className="shrink-0 tabular-nums opacity-80">
                      {meetingDateShort(tarefa.meeting_recorded_at)}
                    </span>
                  )}
                  <span className="truncate max-w-[150px] sm:max-w-[240px]">
                    {meetingSubject(tarefa.meeting_summary) || "reunião"}
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

        {/* direita: deletar (hover) + chevron de expandir */}
        <div className="shrink-0 flex items-center gap-0.5 pr-1.5 sm:pr-2 text-[color:var(--muted)]">
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={doDelete}
                disabled={isPending}
                aria-label="Confirmar deletar"
                className="text-[10px] tracking-[0.1em] uppercase font-bold px-2 py-1 rounded-full bg-[color:var(--urgent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "..." : "deletar"}
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={doReject}
                  disabled={isPending}
                  aria-label="Não é tarefa"
                  title="Não era tarefa — ensina o sistema a não extrair coisas assim"
                  className="text-[10px] tracking-[0.1em] uppercase font-bold px-2 py-1 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] hover:opacity-90 disabled:opacity-50"
                >
                  não é
                </button>
              )}
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
              {isOwner && (
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={isPending}
                  aria-label="Deletar tarefa"
                  className="p-1 rounded-full text-[color:var(--muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[color:var(--urgent)]/10 hover:text-[color:var(--urgent)] transition"
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </button>
              )}
              <ChevronDown
                size={16}
                strokeWidth={1.75}
                className={cn(
                  "transition group-hover:text-[color:var(--foreground)]",
                  expanded && "rotate-180",
                )}
              />
            </>
          )}
        </div>
      </div>

      {/* Expansão in-place (sem pop-up): edição completa do que não cabe na linha */}
      {expanded && (
        <div className="border-t border-[color:var(--border)] bg-[color:var(--accent)]/10 px-4 py-4 animate-[expandIn_160ms_ease-out]">
          <TaskExpandFields tarefa={tarefa} />
        </div>
      )}
    </div>
  );
}

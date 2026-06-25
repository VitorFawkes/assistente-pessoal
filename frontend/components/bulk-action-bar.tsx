"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCheck,
  RotateCcw,
  CalendarClock,
  Flag,
  ArrowLeftRight,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { cn, type Prioridade } from "@/lib/utils";
import { concluirAction, quickDeadlineISO, type QuickWhen } from "@/lib/bulk";
import type { Tarefa, Acao } from "./task-row";

type Frente = { id: string; nome: string };
type Popover = "prazo" | "prioridade" | "acao" | "area" | "delete" | null;

type BatchPatch = Partial<{
  status: "aberta" | "concluida";
  prazo: string | null;
  prioridade: Prioridade;
  acao: Acao;
  owner: string;
  frente_id: string | null;
}>;

// Converte um <input type=date> em ISO no fim do dia local (igual ao edit-modal).
function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 0, 0).toISOString();
}

const PRIORIDADES: { value: Prioridade; label: string; dot: string }[] = [
  { value: "urgente", label: "Urgente", dot: "bg-[color:var(--urgent)]" },
  { value: "alta", label: "Alta", dot: "bg-[color:var(--warm)]" },
  { value: "media", label: "Média", dot: "bg-[color:var(--muted)]" },
  { value: "baixa", label: "Baixa", dot: "bg-[color:var(--muted)] opacity-50" },
];

const QUICK_PRAZOS: { k: QuickWhen; label: string }[] = [
  { k: "hoje", label: "Hoje" },
  { k: "amanha", label: "Amanhã" },
  { k: "sexta", label: "Sexta" },
  { k: "proxsemana", label: "Próx. semana" },
];

export function BulkActionBar({
  selectedIds,
  selectedTarefas,
  frentes,
  allVisibleCount,
  onSelectAll,
  onClear,
}: {
  selectedIds: string[];
  selectedTarefas: Tarefa[];
  frentes: Frente[];
  allVisibleCount: number;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [popover, setPopover] = useState<Popover>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateValue, setDateValue] = useState("");
  const [acaoSel, setAcaoSel] = useState<Acao>("cobrar");
  const [ownerValue, setOwnerValue] = useState("");

  const n = selectedIds.length;
  if (n === 0) return null;

  const concluir = concluirAction(selectedTarefas);
  const allSelected = n >= allVisibleCount && allVisibleCount > 0;

  function run(method: "PATCH" | "DELETE", payload: Record<string, unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch("/api/tarefas/batch", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `erro ${r.status}`);
          return;
        }
        setPopover(null);
        router.refresh();
        onClear();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const apply = (patch: BatchPatch) => run("PATCH", { ids: selectedIds, patch });
  const applyDelete = () => run("DELETE", { ids: selectedIds });

  function togglePopover(p: Exclude<Popover, null>) {
    setError(null);
    setPopover((cur) => (cur === p ? null : p));
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
      <div className="mx-auto max-w-3xl pointer-events-auto">
        {/* Popover acima da barra */}
        {popover && (
          <div className="mb-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-3">
            {popover === "prazo" && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted)]">
                  Definir prazo
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PRAZOS.map((q) => (
                    <button
                      key={q.k}
                      type="button"
                      disabled={isPending}
                      onClick={() => apply({ prazo: quickDeadlineISO(q.k) })}
                      className="text-[13px] px-3 py-1.5 rounded-full border border-[color:var(--border)] hover:bg-[color:var(--accent)] transition disabled:opacity-50"
                    >
                      {q.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => apply({ prazo: null })}
                    className="text-[13px] px-3 py-1.5 rounded-full border border-dashed border-[color:var(--border)] text-[color:var(--muted)] hover:bg-[color:var(--accent)] transition disabled:opacity-50"
                  >
                    Sem prazo
                  </button>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="date"
                    value={dateValue}
                    onChange={(e) => setDateValue(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm"
                  />
                  <button
                    type="button"
                    disabled={isPending || !dateValue}
                    onClick={() => apply({ prazo: dateInputToIso(dateValue) })}
                    className="text-[13px] px-3 py-2 rounded-md bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-40"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            )}

            {popover === "prioridade" && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted)]">
                  Definir prioridade
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PRIORIDADES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      disabled={isPending}
                      onClick={() => apply({ prioridade: p.value })}
                      className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full border border-[color:var(--border)] hover:bg-[color:var(--accent)] transition disabled:opacity-50"
                    >
                      <span className={cn("w-2 h-2 rounded-full", p.dot)} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {popover === "acao" && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted)]">
                  Mudar ação / responsável
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { v: "executar", label: "Eu faço" },
                      { v: "cobrar", label: "Eu cobro" },
                      { v: "aguardar", label: "Aguardar" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setAcaoSel(o.v)}
                      className={cn(
                        "text-[13px] px-3 py-1.5 rounded-full border transition",
                        acaoSel === o.v
                          ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)] font-medium"
                          : "border-[color:var(--border)] hover:bg-[color:var(--accent)]",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {acaoSel === "executar" ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => apply({ acao: "executar" })}
                    className="w-full text-[13px] px-3 py-2 rounded-md bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-40"
                  >
                    Marcar como minhas
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={ownerValue}
                      onChange={(e) => setOwnerValue(e.target.value)}
                      placeholder="responsável (quem faz)"
                      className="flex-1 px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm"
                    />
                    <button
                      type="button"
                      disabled={isPending || !ownerValue.trim()}
                      onClick={() => apply({ acao: acaoSel, owner: ownerValue.trim() })}
                      className="text-[13px] px-3 py-2 rounded-md bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-40"
                    >
                      Aplicar
                    </button>
                  </div>
                )}
              </div>
            )}

            {popover === "area" && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted)]">
                  Atribuir área
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {frentes.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      disabled={isPending}
                      onClick={() => apply({ frente_id: f.id })}
                      className="inline-flex items-center gap-1 text-[13px] px-3 py-1.5 rounded-full border border-[color:var(--border)] hover:bg-[color:var(--accent)] transition disabled:opacity-50"
                    >
                      <Tag size={12} /> {f.nome}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => apply({ frente_id: null })}
                    className="text-[13px] px-3 py-1.5 rounded-full border border-dashed border-[color:var(--border)] text-[color:var(--muted)] hover:bg-[color:var(--accent)] transition disabled:opacity-50"
                  >
                    Sem área
                  </button>
                  {frentes.length === 0 && (
                    <span className="text-[12px] text-[color:var(--muted)]">
                      nenhuma área criada ainda
                    </span>
                  )}
                </div>
              </div>
            )}

            {popover === "delete" && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-[color:var(--muted-strong)]">
                  Apagar {n} {n === 1 ? "tarefa" : "tarefas"}? Não dá pra desfazer.
                </p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={applyDelete}
                  className="shrink-0 text-[13px] px-3 py-2 rounded-md bg-[color:var(--urgent)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {isPending ? "Apagando..." : "Apagar"}
                </button>
              </div>
            )}

            {error && (
              <p className="mt-2 text-[12px] text-[color:var(--urgent)]">{error}</p>
            )}
          </div>
        )}

        {/* Barra principal */}
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl px-3 py-2.5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-semibold">
              {n} {n === 1 ? "selecionada" : "selecionadas"}
            </span>
            <button
              type="button"
              onClick={onSelectAll}
              disabled={allSelected}
              className="text-[12px] px-2 py-0.5 rounded-full border border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] disabled:opacity-40"
            >
              tudo ({allVisibleCount})
            </button>
            <button
              type="button"
              onClick={onClear}
              className="text-[12px] px-2 py-0.5 rounded-full text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            >
              limpar
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onClear}
              aria-label="Fechar seleção"
              className="p-1 rounded-full text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex items-center flex-wrap gap-1.5">
            <BarButton
              icon={concluir.status === "aberta" ? <RotateCcw size={15} /> : <CheckCheck size={15} />}
              label={concluir.label}
              disabled={isPending}
              onClick={() => apply({ status: concluir.status })}
            />
            <BarButton
              icon={<CalendarClock size={15} />}
              label="Prazo"
              active={popover === "prazo"}
              disabled={isPending}
              onClick={() => togglePopover("prazo")}
            />
            <BarButton
              icon={<Flag size={15} />}
              label="Prioridade"
              active={popover === "prioridade"}
              disabled={isPending}
              onClick={() => togglePopover("prioridade")}
            />
            <BarButton
              icon={<ArrowLeftRight size={15} />}
              label="Ação/Dono"
              active={popover === "acao"}
              disabled={isPending}
              onClick={() => togglePopover("acao")}
            />
            <BarButton
              icon={<Tag size={15} />}
              label="Área"
              active={popover === "area"}
              disabled={isPending}
              onClick={() => togglePopover("area")}
            />
            <BarButton
              icon={<Trash2 size={15} />}
              label="Deletar"
              danger
              active={popover === "delete"}
              disabled={isPending}
              onClick={() => togglePopover("delete")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function BarButton({
  icon,
  label,
  onClick,
  active,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "press-feedback inline-flex items-center gap-1.5 text-[13px] px-2.5 py-1.5 rounded-full border transition disabled:opacity-50",
        danger
          ? "border-[color:var(--urgent)]/40 text-[color:var(--urgent)] hover:bg-[color:var(--urgent)]/10"
          : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
        active &&
          (danger
            ? "bg-[color:var(--urgent)]/10"
            : "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)]"),
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

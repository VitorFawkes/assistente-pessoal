"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  Flame,
  Tag,
  UserRound,
  Bell,
  Send,
  Check,
} from "lucide-react";
import { cn, formatPrazo, normalizeOwner, type Prioridade } from "@/lib/utils";
import { useTaskMutations } from "@/lib/task-mutations";
import type { Tarefa, Acao } from "@/lib/queries";

// ─── Popover inline (posição fixed → escapa o overflow-hidden do card e o
//     clipping da lista; fecha no clique-fora / Esc). Reutilizado por todos os chips.
function InlinePopover({
  trigger,
  triggerClass,
  ariaLabel,
  width = 232,
  onOpen,
  children,
}: {
  trigger: ReactNode;
  triggerClass: string;
  ariaLabel: string;
  width?: number;
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  } | null>(null);
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
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
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
      if (r) {
        const w = Math.min(width, window.innerWidth - 16);
        const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
        const spaceBelow = window.innerHeight - r.bottom;
        // Abre pra cima quando não há espaço suficiente embaixo.
        const openUp = spaceBelow < 260 && r.top > spaceBelow;
        setPos(
          openUp
            ? { bottom: window.innerHeight - r.top + 6, left, width: w }
            : { top: r.bottom + 6, left, width: w },
        );
      }
      onOpen?.();
    }
    setOpen((v) => !v);
  }

  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={triggerClass}
      >
        {trigger}
      </button>
      {open && pos && (
        <div
          ref={popRef}
          role="dialog"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          style={{
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            width: pos.width,
          }}
          className="fixed z-50 max-h-[60vh] overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-1.5"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

function MenuItem({
  onClick,
  children,
  tone,
  active,
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: "danger" | "muted";
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "w-full flex items-center justify-between gap-2 text-left text-[13px] px-2 py-1.5 rounded-lg transition",
        active
          ? "bg-[color:var(--accent)] text-[color:var(--foreground)] font-medium"
          : tone === "danger"
          ? "text-[color:var(--urgent)] hover:bg-[color:var(--urgent)]/10"
          : tone === "muted"
          ? "text-[color:var(--muted)] hover:bg-[color:var(--accent)]"
          : "text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
      )}
    >
      {children}
    </button>
  );
}

// ─── Datas ────────────────────────────────────────────────────────────
function nextWeekday(target: number): Date {
  const d = new Date();
  const delta = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}
function isoEndOfDay(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 0, 0);
  return x.toISOString();
}

function prazoChipColor(status: ReturnType<typeof formatPrazo>["status"]): string {
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

// ─── Prazo ────────────────────────────────────────────────────────────
export function PrazoInline({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const prazo = formatPrazo(tarefa.prazo);
  const set = (iso: string | null, close: () => void) => {
    mut.patch(tarefa.id, { prazo: iso, prazo_text: null }, { silent: true });
    close();
  };
  const quick: { k: string; label: string; date: () => Date }[] = [
    { k: "hoje", label: "Hoje", date: () => new Date() },
    {
      k: "amanha",
      label: "Amanhã",
      date: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d;
      },
    },
    { k: "sexta", label: "Sexta", date: () => nextWeekday(5) },
    {
      k: "prox",
      label: "Próx. semana",
      date: () => nextWeekday(1),
    },
  ];
  return (
    <InlinePopover
      ariaLabel="Mudar prazo"
      width={208}
      triggerClass={cn(
        "inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap cursor-pointer transition hover:ring-1 hover:ring-[color:var(--muted)]/40",
        prazoChipColor(prazo.status),
      )}
      trigger={
        <>
          <CalendarClock size={10} />
          {prazo.text}
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col">
          {quick.map((q) => (
            <MenuItem key={q.k} onClick={() => set(isoEndOfDay(q.date()), close)}>
              {q.label}
            </MenuItem>
          ))}
          <input
            type="date"
            className="mx-1 my-1 px-2 py-1 text-[13px] rounded border border-[color:var(--border)] bg-transparent"
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                const [y, m, d] = v.split("-").map(Number);
                set(isoEndOfDay(new Date(y, m - 1, d)), close);
              }
            }}
          />
          {tarefa.prazo && (
            <MenuItem tone="danger" onClick={() => set(null, close)}>
              remover prazo
            </MenuItem>
          )}
        </div>
      )}
    </InlinePopover>
  );
}

// ─── Prioridade ───────────────────────────────────────────────────────
const PRIORIDADES: { v: Prioridade; label: string; dot: string }[] = [
  { v: "urgente", label: "Urgente", dot: "bg-[color:var(--urgent)]" },
  { v: "alta", label: "Alta", dot: "bg-[color:var(--warm)]" },
  { v: "media", label: "Média", dot: "bg-[color:var(--muted)]" },
  { v: "baixa", label: "Baixa", dot: "bg-[color:var(--muted)] opacity-50" },
];

export function PrioridadeInline({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const cur = PRIORIDADES.find((p) => p.v === tarefa.prioridade)!;
  const isHigh = tarefa.prioridade === "urgente" || tarefa.prioridade === "alta";
  return (
    <InlinePopover
      ariaLabel="Mudar prioridade"
      width={176}
      triggerClass={cn(
        "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap cursor-pointer transition",
        tarefa.prioridade === "urgente"
          ? "bg-[color:var(--urgent)] text-white"
          : tarefa.prioridade === "alta"
          ? "bg-[color:var(--warm-bg)] text-[color:var(--warm)]"
          : "bg-[color:var(--accent)] text-[color:var(--muted-strong)]",
      )}
      trigger={
        <>
          {isHigh ? (
            <Flame size={10} strokeWidth={2.5} />
          ) : (
            <span className={cn("w-2 h-2 rounded-full", cur.dot)} />
          )}
          {cur.label}
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col">
          {PRIORIDADES.map((p) => (
            <MenuItem
              key={p.v}
              active={p.v === tarefa.prioridade}
              onClick={() => {
                mut.patch(tarefa.id, { prioridade: p.v }, { silent: true });
                close();
              }}
            >
              <span className="inline-flex items-center gap-2">
                <span className={cn("w-2 h-2 rounded-full", p.dot)} />
                {p.label}
              </span>
              {p.v === tarefa.prioridade && <Check size={13} />}
            </MenuItem>
          ))}
        </div>
      )}
    </InlinePopover>
  );
}

// ─── Área ─────────────────────────────────────────────────────────────
export function AreaInline({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const atual = tarefa.frente;
  const proposta = !tarefa.frente && tarefa.frente_proposta ? tarefa.frente_proposta : null;

  async function ensure() {
    if (loaded) return;
    const list = await mut.listFrentes();
    setFrentes(list);
    setLoaded(true);
  }

  return (
    <InlinePopover
      ariaLabel="Mudar área"
      width={208}
      onOpen={ensure}
      triggerClass={cn(
        "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap cursor-pointer transition max-w-[140px] truncate hover:ring-1 hover:ring-[color:var(--muted)]/40",
        atual
          ? "bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
          : proposta
          ? "border border-dashed border-[color:var(--warm)]/40 text-[color:var(--warm)]"
          : "border border-dashed border-[color:var(--border)] text-[color:var(--muted)]",
      )}
      trigger={
        <>
          <Tag size={10} />
          <span className="truncate">{atual ?? (proposta ? `${proposta}?` : "+ área")}</span>
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col">
          <MenuItem
            tone="muted"
            active={!atual}
            onClick={() => {
              mut.patch(tarefa.id, { frente_id: null }, { silent: true });
              close();
            }}
          >
            — sem área —
          </MenuItem>
          {!loaded && (
            <span className="px-2 py-1.5 text-[12px] text-[color:var(--muted)]">
              carregando…
            </span>
          )}
          {frentes.map((f) => (
            <MenuItem
              key={f.id}
              active={f.nome === atual}
              onClick={() => {
                mut.patch(tarefa.id, { frente_id: f.id }, { silent: true });
                close();
              }}
            >
              {f.nome}
              {f.nome === atual && <Check size={13} />}
            </MenuItem>
          ))}
        </div>
      )}
    </InlinePopover>
  );
}

// ─── Ação + responsável ───────────────────────────────────────────────
export function AcaoInline({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const [draft, setDraft] = useState<Acao>(tarefa.acao);
  const [owner, setOwner] = useState(
    tarefa.owner && tarefa.owner !== "?" && tarefa.owner.toLowerCase() !== "vitor"
      ? tarefa.owner
      : "",
  );
  const isExec = tarefa.acao === "executar";
  const isCobrar = tarefa.acao === "cobrar";
  const ownerLabel = normalizeOwner(tarefa.owner);

  const apply = (acao: Acao, ownerValue: string, close: () => void) => {
    mut.patch(
      tarefa.id,
      { acao, owner: acao === "executar" ? "vitor" : ownerValue.trim() || "?" },
      { silent: true },
    );
    close();
  };

  return (
    <InlinePopover
      ariaLabel="Trocar ação / responsável"
      width={232}
      triggerClass={cn(
        "inline-flex items-center gap-0.5 text-[10px] tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap cursor-pointer transition",
        isExec
          ? "bg-[color:var(--calm-bg)] text-[color:var(--calm)] font-medium hover:ring-1 hover:ring-[color:var(--calm)]/40"
          : isCobrar
          ? "bg-[color:var(--warm-bg)] text-[color:var(--warm)] font-semibold ring-1 ring-[color:var(--warm)]/30"
          : "bg-[color:var(--warm-bg)]/60 text-[color:var(--warm)] font-medium",
      )}
      trigger={
        <>
          {isExec ? (
            <UserRound size={10} strokeWidth={2} />
          ) : isCobrar ? (
            <Bell size={10} strokeWidth={2} />
          ) : (
            <Send size={10} strokeWidth={2} />
          )}
          <span className="max-w-[120px] truncate">
            {isExec ? "minha" : ownerLabel}
          </span>
        </>
      }
    >
      {(close) => (
        <div className="space-y-2 p-1">
          <div className="flex flex-wrap gap-1">
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
                onClick={() =>
                  o.v === "executar" ? apply("executar", "", close) : setDraft(o.v)
                }
                className={cn(
                  "text-[12px] px-2 py-1 rounded-full border transition",
                  draft === o.v
                    ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)] font-medium"
                    : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {draft !== "executar" && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && owner.trim()) apply(draft, owner, close);
                }}
                placeholder="responsável"
                autoFocus
                className="flex-1 min-w-0 px-2 py-1 rounded border border-[color:var(--border)] bg-transparent text-[12px] outline-none focus:border-[color:var(--muted)]"
              />
              <button
                type="button"
                disabled={!owner.trim()}
                onClick={() => apply(draft, owner, close)}
                className="shrink-0 text-[12px] px-2.5 py-1 rounded bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-40"
              >
                ok
              </button>
            </div>
          )}
        </div>
      )}
    </InlinePopover>
  );
}

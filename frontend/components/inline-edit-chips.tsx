"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CalendarClock,
  Flame,
  Tag,
  UserRound,
  Send,
  Check,
} from "lucide-react";
import {
  cn,
  formatPrazo,
  normalizeOwner,
  isOwnerMe,
  acaoForOwner,
  type Prioridade,
} from "@/lib/utils";
import { useTaskMutations } from "@/lib/task-mutations";
import type { Tarefa } from "@/lib/queries";

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
      {open && pos && typeof document !== "undefined" &&
        createPortal(
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
            className="fixed z-[80] max-h-[60vh] overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-1.5"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
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

// ─── Dono da tarefa ───────────────────────────────────────────────────
// Edição direta do DONO pelo nome: clique no chip → digite o nome (ou escolha
// de pessoas já existentes) → pronto. Sem o modelo "Eu faço / Eu cobro /
// Aguardar" — a coluna `acao` é derivada do nome (você → executar; outro →
// cobrar) só pra manter filtros/plano/agrupamento coerentes.
export { OwnerInline as AcaoInline };

export function OwnerInline({ tarefa }: { tarefa: Tarefa }) {
  return (
    <InlinePopover
      ariaLabel="Trocar dono da tarefa"
      width={232}
      triggerClass={cn(
        "inline-flex items-center gap-0.5 text-[10px] tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap cursor-pointer transition",
        isOwnerMe(tarefa.owner)
          ? "bg-[color:var(--calm-bg)] text-[color:var(--calm)] font-medium hover:ring-1 hover:ring-[color:var(--calm)]/40"
          : "bg-[color:var(--warm-bg)] text-[color:var(--warm)] font-medium hover:ring-1 hover:ring-[color:var(--warm)]/40",
      )}
      trigger={
        <>
          <UserRound size={10} strokeWidth={2} />
          <span className="max-w-[120px] truncate">{normalizeOwner(tarefa.owner)}</span>
        </>
      }
    >
      {(close) => <OwnerPicker tarefa={tarefa} close={close} />}
    </InlinePopover>
  );
}

// Conteúdo reutilizável do editor de dono (usado no chip inline e no expand).
export function OwnerPicker({
  tarefa,
  close,
  autoFocus = true,
}: {
  tarefa: Tarefa;
  close: () => void;
  autoFocus?: boolean;
}) {
  const mut = useTaskMutations();
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);
  const [txt, setTxt] = useState("");

  useEffect(() => {
    let alive = true;
    mut.listPessoas().then((list) => {
      if (alive) setPessoas(list);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setOwner = (nome: string) => {
    const owner = nome.trim();
    // "vitor"/vazio ⇒ você (executar); qualquer outro ⇒ cobrar. Manda os dois
    // pra rota manter o invariante e recalcular a pessoa principal / agrupamento.
    mut.patch(
      tarefa.id,
      { owner: owner || "vitor", acao: acaoForOwner(owner) },
      { silent: true },
    );
    close();
  };

  const q = txt.trim().toLowerCase();
  const sugestoes = pessoas
    .filter((p) => !isOwnerMe(p.nome) && p.nome.toLowerCase().includes(q))
    .slice(0, 6);
  const jaSou = isOwnerMe(tarefa.owner);

  return (
    <div className="flex flex-col">
      <div className="px-1.5 pt-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-[color:var(--muted)]">
        Dono da tarefa
      </div>
      <input
        type="text"
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && txt.trim()) setOwner(txt);
        }}
        placeholder="nome do dono + Enter"
        autoFocus={autoFocus}
        className="mx-1 mb-1 px-2 py-1.5 rounded border border-[color:var(--border)] bg-transparent text-[13px] outline-none focus:border-[color:var(--muted)]"
      />
      <MenuItem active={jaSou} onClick={() => setOwner("vitor")}>
        <span className="inline-flex items-center gap-2">
          <UserRound size={13} className="text-[color:var(--calm)]" />
          Vitor (você)
        </span>
        {jaSou && <Check size={13} />}
      </MenuItem>
      {sugestoes.map((p) => (
        <MenuItem
          key={p.id || p.nome}
          active={p.nome.toLowerCase() === (tarefa.owner ?? "").toLowerCase()}
          onClick={() => setOwner(p.nome)}
        >
          {p.nome}
          {p.nome.toLowerCase() === (tarefa.owner ?? "").toLowerCase() && <Check size={13} />}
        </MenuItem>
      ))}
      {txt.trim() && !sugestoes.some((p) => p.nome.toLowerCase() === q) && (
        <MenuItem onClick={() => setOwner(txt)}>
          <span className="inline-flex items-center gap-2">
            <Send size={12} className="text-[color:var(--warm)]" />
            Passar para &ldquo;{txt.trim()}&rdquo;
          </span>
        </MenuItem>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Inbox,
  ListChecks,
  UserRound,
  Crosshair,
  Circle,
  CircleDot,
  CheckCircle2,
  Tag,
  Pencil,
  GripVertical,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskEditModal } from "./task-edit-modal";
import { PlanoManageModal } from "./plano-manage-modal";
import type { Tarefa } from "./task-row";
import {
  axisTicks,
  buildDomain,
  dayIndexOf,
  geomOf,
  idxToDateKey,
  labelIdx,
  monthSegments,
  sortIdxOf,
  todayIndex,
  weekendSegments,
  type Domain,
  type TaskGeom,
} from "@/lib/plano";

type GroupBy = "frente" | "responsavel" | "tarefa";
type Zoom = "dia" | "semana" | "mes";

const PX: Record<Zoom, number> = { dia: 58, semana: 30, mes: 12 };
const LABEL_W = 252;
const ROW_H = 46;
const HEAD_H = 70;
const MONTH_H = 30;
const GROUP_H = 38;
const BAR_H = 26;
const DIAMOND = 15;

function isOpen(t: Tarefa) {
  return t.status !== "concluida" && t.status !== "cancelada";
}
function isDone(t: Tarefa) {
  return t.status === "concluida" || t.status === "cancelada";
}

function responsavelOf(t: Tarefa): string {
  if (t.acao === "executar") return "Você";
  const o = (t.owner || "").trim();
  if (o && o !== "?" && o.toLowerCase() !== "vitor") return o;
  const principal = (t.pessoas ?? []).find((p) => p.principal) ?? (t.pessoas ?? [])[0];
  return principal?.nome ?? "Alguém";
}
function frenteOf(t: Tarefa): string {
  return t.frente || t.frente_proposta || "Sem área";
}

// cor da barra/marco por prioridade (paleta do tema)
function prioColor(p: Tarefa["prioridade"]): string {
  switch (p) {
    case "urgente":
      return "var(--urgent)";
    case "alta":
      return "var(--warm)";
    case "baixa":
      return "var(--muted)";
    default:
      return "var(--muted-strong)"; // media
  }
}

// índice de dia → ISO (início = 00:00 local, fim/prazo = 23:59 local — igual ao modal)
function idxToIso(idx: number, end: boolean): string {
  const [y, m, d] = idxToDateKey(idx).split("-").map((s) => parseInt(s, 10));
  return new Date(y, m - 1, d, end ? 23 : 0, end ? 59 : 0, 0, 0).toISOString();
}

// yyyy-mm-dd (input date) → ISO (pra gaveta "sem data")
function dInputToIso(value: string, end: boolean): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, end ? 23 : 0, end ? 59 : 0, 0, 0).toISOString();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="inline-flex rounded-full bg-[color:var(--accent)]/70 p-0.5 ring-1 ring-[color:var(--border)]">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "text-[12px] px-3 py-1 rounded-full transition cursor-pointer",
            value === v
              ? "bg-[color:var(--foreground)] text-[color:var(--background)] font-medium shadow-sm"
              : "text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)]",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

type DragState = {
  id: string;
  mode: "move" | "resize-l" | "resize-r";
  startX: number;
  base: TaskGeom;
  serverGeom: TaskGeom;
  sig: string;
  pxDay: number;
  domain: Domain;
  last: TaskGeom;
  move: (e: PointerEvent) => void;
};

export function PlanoTimeline({ tarefas }: { tarefas: Tarefa[] }) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("frente");
  const [zoom, setZoom] = useState<Zoom>("semana");
  const [showDone, setShowDone] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Tarefa | null>(null);
  const [adding, setAdding] = useState(false);

  // edição inline
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [popover, setPopover] = useState<{
    id: string;
    field: "area" | "pessoa";
    x: number;
    y: number;
  } | null>(null);
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);

  // arrastar + fantasma ("andou de data")
  // override.sig = datas do servidor no início do arrasto; quando o servidor
  // alcança (sig muda), o override fica inerte sozinho — sem efeito/limpeza.
  const [overrides, setOverrides] = useState<Record<string, { geom: TaskGeom; sig: string }>>({});
  const [ghosts, setGhosts] = useState<Record<string, TaskGeom>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const movedRef = useRef(false);

  // reordenar manual (arrastar linha pra cima/baixo) — só no modo "Por tarefa"
  const [ordemOver, setOrdemOver] = useState<Record<string, number>>({});
  const [rowDragId, setRowDragId] = useState<string | null>(null);
  const rowDragRef = useRef<null | {
    id: string;
    startIndex: number;
    startY: number;
    baseOrder: string[];
    last: string[];
    move: (e: PointerEvent) => void;
  }>(null);

  const pxDay = PX[zoom];
  const today = todayIndex();

  const byId = useMemo(() => {
    const m = new Map<string, Tarefa>();
    for (const t of tarefas) m.set(t.id, t);
    return m;
  }, [tarefas]);

  // só entra na timeline o que está NO PLANO (opt-in). Tarefas de reunião não vazam.
  const visible = useMemo(
    () => tarefas.filter((t) => t.no_plano && (showDone ? true : isOpen(t))),
    [tarefas, showDone],
  );
  const dated = useMemo(() => visible.filter((t) => geomOf(t) !== null), [visible]);
  const undated = useMemo(() => visible.filter((t) => geomOf(t) === null), [visible]);

  const domain = useMemo<Domain>(() => {
    const idxs: number[] = [];
    for (const t of dated) {
      const g = geomOf(t)!;
      if (g.kind === "bar") idxs.push(g.startIdx, g.endIdx);
      else idxs.push(g.idx);
    }
    // horizonte de planejamento: sempre dá pra rolar pras semanas/meses seguintes,
    // mesmo sem tarefas lá. A folga cresce com o zoom (Mês mostra meses à frente).
    const H: Record<Zoom, { past: number; future: number }> = {
      dia: { past: 5, future: 28 },
      semana: { past: 7, future: 84 },
      mes: { past: 14, future: 200 },
    };
    idxs.push(today - H[zoom].past, today + H[zoom].future);
    return buildDomain(idxs, today);
  }, [dated, today, zoom]);

  const months = useMemo(() => monthSegments(domain), [domain]);
  const ticks = useMemo(() => axisTicks(domain), [domain]);
  const weekends = useMemo(() => weekendSegments(domain), [domain]);

  // células de semana (zoom "semana") — uma por semana (segunda→domingo)
  const weekCells = useMemo(() => {
    const cells: { startIdx: number; offset: number; days: number }[] = [];
    let cur: { startIdx: number; offset: number; days: number } | null = null;
    for (const tk of ticks) {
      if (cur === null || tk.isWeekStart) {
        if (cur) cells.push(cur);
        cur = { startIdx: tk.idx, offset: tk.offset, days: 1 };
      } else {
        cur.days++;
      }
    }
    if (cur) cells.push(cur);
    return cells;
  }, [ticks]);

  // células de ano (faixa de topo do zoom "mês")
  const yearCells = useMemo(() => {
    const cells: { startIdx: number; days: number; year: string }[] = [];
    let cur: { startIdx: number; days: number; year: string } | null = null;
    for (const mo of months) {
      const year = mo.label.trim().split(/\s+/).pop() ?? "";
      if (!cur || cur.year !== year) {
        if (cur) cells.push(cur);
        cur = { startIdx: mo.startIdx, days: mo.days, year };
      } else {
        cur.days += mo.days;
      }
    }
    if (cur) cells.push(cur);
    return cells;
  }, [months]);

  const sigOf = (t: Tarefa) => `${t.inicio ?? ""}|${t.prazo ?? ""}`;
  const effGeom = useCallback(
    (t: Tarefa): TaskGeom => {
      const ov = overrides[t.id];
      // só usa a posição otimista enquanto o servidor ainda não refletiu o arrasto
      return ov && ov.sig === sigOf(t) ? ov.geom : geomOf(t);
    },
    [overrides],
  );

  // chave de ordenação: ordem manual (override de arrasto → coluna `ordem`) ou fallback por data
  const ORD_BASE = 10_000_000;
  const orderKey = useCallback(
    (t: Tarefa) => {
      if (ordemOver[t.id] !== undefined) return ordemOver[t.id];
      if (t.ordem != null) return t.ordem;
      return ORD_BASE + sortIdxOf(t);
    },
    [ordemOver],
  );

  const groups = useMemo(() => {
    // modo "por tarefa": lista única, sem cabeçalho de grupo
    if (groupBy === "tarefa") {
      const items = [...dated].sort((a, b) => orderKey(a) - orderKey(b));
      return items.length ? [{ key: "__all__", items, first: 0 }] : [];
    }
    const m = new Map<string, Tarefa[]>();
    for (const t of dated) {
      const k = groupBy === "frente" ? frenteOf(t) : responsavelOf(t);
      const arr = m.get(k);
      if (arr) arr.push(t);
      else m.set(k, [t]);
    }
    const out = Array.from(m.entries()).map(([key, items]) => {
      items.sort((a, b) => orderKey(a) - orderKey(b));
      return { key, items, first: Math.min(...items.map(orderKey)) };
    });
    out.sort((a, b) => a.first - b.first || a.key.localeCompare(b.key, "pt-BR"));
    return out;
  }, [dated, groupBy, orderKey]);

  const timelineW = domain.days * pxDay;
  const todayLeft = LABEL_W + (today - domain.startIdx) * pxDay + pxDay / 2;

  const scrollToToday = useCallback(
    (smooth = true) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({
        left: Math.max(0, (today - domain.startIdx) * pxDay - 140),
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [today, domain.startIdx, pxDay],
  );

  // rola o eixo do tempo ~80% da área visível (navegar semanas/meses)
  const scrollByPage = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, (el.clientWidth - LABEL_W) * 0.8), behavior: "smooth" });
  };

  // centraliza no "hoje" ao montar e quando o zoom muda
  useEffect(() => {
    scrollToToday(false);
  }, [zoom, scrollToToday]);

  // listas pra edição inline (área / pessoa)
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/frentes", { signal: ac.signal })
      .then((r) => r.json())
      .then((d: { frentes?: { id: string; nome: string }[] }) => setFrentes(d.frentes ?? []))
      .catch(() => {});
    fetch("/api/pessoas", { signal: ac.signal })
      .then((r) => r.json())
      .then((d: { id: string; nome: string }[] | { error?: string }) =>
        Array.isArray(d) ? setPessoas(d) : undefined,
      )
      .catch(() => {});
    return () => ac.abort();
  }, []);

  // fecha popover/edição com Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPopover(null);
        setEditTitle(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      await fetch(`/api/tarefas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    },
    [router],
  );

  function cycleStatus(t: Tarefa) {
    const next: Tarefa["status"] =
      t.status === "aberta"
        ? "em_andamento"
        : t.status === "em_andamento"
        ? "concluida"
        : "aberta"; // concluida/cancelada → reabre
    patch(t.id, { status: next });
  }

  function saveTitle(t: Tarefa, value: string) {
    const v = value.trim();
    setEditTitle(null);
    if (v && v !== t.titulo) patch(t.id, { titulo: v });
  }

  function setArea(t: Tarefa, frenteId: string | null) {
    setPopover(null);
    patch(t.id, { frente_id: frenteId });
  }

  function setResponsavel(t: Tarefa, nome: string | null) {
    setPopover(null);
    if (nome === null) {
      patch(t.id, { acao: "executar" }); // "Você"
    } else {
      patch(t.id, { owner: nome, acao: t.acao === "executar" ? "cobrar" : t.acao });
    }
  }

  // ── arrastar datas ──────────────────────────────────────────────────
  function startDrag(
    e: React.PointerEvent,
    t: Tarefa,
    mode: "move" | "resize-l" | "resize-r",
  ) {
    const g = effGeom(t);
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    // cancela um arrasto anterior que não tenha finalizado (evita listener órfão)
    if (dragRef.current) window.removeEventListener("pointermove", dragRef.current.move);
    movedRef.current = false;
    const base: TaskGeom =
      g.kind === "bar"
        ? { kind: "bar", startIdx: g.startIdx, endIdx: g.endIdx }
        : { kind: "milestone", idx: g.idx };

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !d.base) return;
      const deltaDays = Math.round((ev.clientX - d.startX) / d.pxDay);
      if (deltaDays !== 0) movedRef.current = true;
      let next: TaskGeom;
      if (d.base.kind === "bar") {
        let s = d.base.startIdx;
        let en = d.base.endIdx;
        if (d.mode === "move") {
          const span = d.base.endIdx - d.base.startIdx;
          s = clamp(d.base.startIdx + deltaDays, d.domain.startIdx, d.domain.endIdx - span);
          en = s + span;
        } else if (d.mode === "resize-l") {
          s = clamp(d.base.startIdx + deltaDays, d.domain.startIdx, d.base.endIdx);
        } else {
          en = clamp(d.base.endIdx + deltaDays, d.base.startIdx, d.domain.endIdx);
        }
        next = { kind: "bar", startIdx: s, endIdx: en };
      } else {
        next = {
          kind: "milestone",
          idx: clamp(d.base.idx + deltaDays, d.domain.startIdx, d.domain.endIdx),
        };
      }
      d.last = next;
      setOverrides((o) => ({ ...o, [d.id]: { geom: next, sig: d.sig } }));
    };

    dragRef.current = {
      id: t.id,
      mode,
      startX: e.clientX,
      base,
      serverGeom: geomOf(t),
      sig: sigOf(t),
      pxDay,
      domain,
      last: base,
      move,
    };
    setHoverId(t.id);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", endDrag, { once: true });
  }

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d) window.removeEventListener("pointermove", d.move);
    const wasMoved = movedRef.current;
    movedRef.current = false; // reseta sempre — senão um drag interrompido engole o próximo clique
    if (!d || !wasMoved || !d.last) return;
    const t = byId.get(d.id);
    if (!t) return;
    // guarda a posição original (1ª vez que essa tarefa anda nesta sessão)
    if (d.serverGeom) {
      setGhosts((gh) => (gh[d.id] ? gh : { ...gh, [d.id]: d.serverGeom }));
    }
    if (d.last.kind === "bar") {
      patch(d.id, {
        inicio: idxToIso(d.last.startIdx, false),
        prazo: idxToIso(d.last.endIdx, true),
      });
    } else {
      const field = t.prazo ? "prazo" : "inicio";
      patch(d.id, { [field]: idxToIso(d.last.idx, field === "prazo") });
    }
  }, [byId, patch]);

  useEffect(() => {
    return () => {
      const d = dragRef.current;
      if (d) window.removeEventListener("pointermove", d.move);
      const rd = rowDragRef.current;
      if (rd) window.removeEventListener("pointermove", rd.move);
      movedRef.current = false;
    };
  }, []);

  function restoreGhost(t: Tarefa) {
    const g = ghosts[t.id];
    if (!g) return;
    setGhosts((gh) => {
      const rest = { ...gh };
      delete rest[t.id];
      return rest;
    });
    if (g.kind === "bar") {
      patch(t.id, { inicio: idxToIso(g.startIdx, false), prazo: idxToIso(g.endIdx, true) });
    } else {
      const field = t.prazo ? "prazo" : "inicio";
      patch(t.id, { [field]: idxToIso(g.idx, field === "prazo") });
    }
  }

  // ── reordenar (arrastar linha) ──────────────────────────────────────
  const endRowDrag = useCallback(() => {
    const d = rowDragRef.current;
    rowDragRef.current = null;
    if (d) window.removeEventListener("pointermove", d.move);
    setRowDragId(null);
    if (!d) return;
    const changed = d.last.some((id, i) => id !== d.baseOrder[i]);
    if (changed) {
      fetch("/api/tarefas/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: d.last }),
      }).then(() => router.refresh());
    }
  }, [router]);

  function startRowDrag(e: React.PointerEvent, t: Tarefa) {
    if (groupBy !== "tarefa") return;
    e.preventDefault();
    e.stopPropagation();
    if (rowDragRef.current) window.removeEventListener("pointermove", rowDragRef.current.move);
    const baseOrder = (groups[0]?.items ?? []).map((x) => x.id);
    const startIndex = baseOrder.indexOf(t.id);
    if (startIndex < 0) return;
    setRowDragId(t.id);
    const move = (ev: PointerEvent) => {
      const d = rowDragRef.current;
      if (!d) return;
      const deltaIdx = Math.round((ev.clientY - d.startY) / ROW_H);
      const target = clamp(d.startIndex + deltaIdx, 0, d.baseOrder.length - 1);
      const without = d.baseOrder.filter((id) => id !== d.id);
      without.splice(target, 0, d.id);
      d.last = without;
      setOrdemOver(Object.fromEntries(without.map((id, i) => [id, i * 10])));
    };
    rowDragRef.current = { id: t.id, startIndex, startY: e.clientY, baseOrder, last: baseOrder, move };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", endRowDrag, { once: true });
  }

  function tip(t: Tarefa): string {
    const g = effGeom(t);
    const parts: string[] = [t.titulo, responsavelOf(t)];
    if (g?.kind === "bar")
      parts.push(`${labelIdx(g.startIdx, "dd/MM")} → ${labelIdx(g.endIdx, "dd/MM")}`);
    else if (g?.kind === "milestone") parts.push(labelIdx(g.idx, "dd/MM"));
    return parts.join(" · ");
  }

  // ── render: trilha (barra ou marco + fantasma) ──────────────────────
  function renderTrack(t: Tarefa) {
    const g = effGeom(t)!;
    const done = isDone(t);
    const andamento = t.status === "em_andamento";
    const color = prioColor(t.prioridade);
    const overdue = !done && t.prazo != null && dayIndexOf(t.prazo) < today;
    const resp = responsavelOf(t);
    const ghost = ghosts[t.id];
    const isHover = hoverId === t.id;

    const newCenter =
      g.kind === "bar"
        ? ((g.startIdx + g.endIdx) / 2 - domain.startIdx + 0.5) * pxDay
        : (g.idx - domain.startIdx + 0.5) * pxDay;

    return (
      <div className="relative h-full" style={{ width: timelineW }}>
        {/* fantasma da posição original */}
        {ghost &&
          (() => {
            const oCenter =
              ghost.kind === "bar"
                ? ((ghost.startIdx + ghost.endIdx) / 2 - domain.startIdx + 0.5) * pxDay
                : (ghost.idx - domain.startIdx + 0.5) * pxDay;
            const a = Math.min(oCenter, newCenter);
            const b = Math.max(oCenter, newCenter);
            return (
              <>
                {/* conector tracejado */}
                <div
                  className="absolute top-1/2 h-px -translate-y-1/2 pointer-events-none"
                  style={{
                    left: a,
                    width: Math.max(b - a, 1),
                    backgroundImage:
                      "repeating-linear-gradient(90deg, var(--muted) 0 4px, transparent 4px 8px)",
                    opacity: 0.5,
                  }}
                  aria-hidden
                />
                {/* contorno na posição antiga (clicável = voltar) */}
                {ghost.kind === "bar" ? (
                  <button
                    type="button"
                    title="voltar pra data original"
                    onClick={() => restoreGhost(t)}
                    className="absolute top-1/2 -translate-y-1/2 rounded-full border border-dashed border-[color:var(--muted)] opacity-50 hover:opacity-90 transition"
                    style={{
                      left: (ghost.startIdx - domain.startIdx) * pxDay,
                      width: Math.max((ghost.endIdx - ghost.startIdx + 1) * pxDay, pxDay),
                      height: BAR_H,
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    title="voltar pra data original"
                    onClick={() => restoreGhost(t)}
                    className="absolute top-1/2 -translate-y-1/2 opacity-50 hover:opacity-90 transition"
                    style={{ left: (ghost.idx - domain.startIdx + 0.5) * pxDay - DIAMOND / 2 }}
                  >
                    <span
                      className="block rotate-45 rounded-[2px] border border-dashed border-[color:var(--muted)]"
                      style={{ width: DIAMOND, height: DIAMOND }}
                    />
                  </button>
                )}
              </>
            );
          })()}

        {g.kind === "bar" ? (
          <div
            role="button"
            tabIndex={0}
            title={tip(t)}
            onPointerDown={(e) => startDrag(e, t, "move")}
            onClick={() => {
              if (movedRef.current) {
                movedRef.current = false;
                return;
              }
              setEditing(t);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") setEditing(t);
            }}
            onMouseEnter={() => setHoverId(t.id)}
            className={cn(
              "plano-focus group absolute top-1/2 -translate-y-1/2 flex items-center px-2.5 overflow-visible cursor-grab active:cursor-grabbing select-none touch-none",
              andamento && !done && "plano-progress",
            )}
            style={{
              left: (g.startIdx - domain.startIdx) * pxDay,
              width: Math.max((g.endIdx - g.startIdx + 1) * pxDay, pxDay),
              height: BAR_H,
              borderRadius: 999,
              background: done
                ? `color-mix(in oklab, ${color} 26%, var(--card))`
                : `linear-gradient(180deg, color-mix(in oklab, ${color} 86%, #fff 14%), ${color})`,
              boxShadow: done
                ? "none"
                : `0 1px 2px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.28)`,
              outline: overdue ? "2px solid var(--urgent)" : "none",
              outlineOffset: overdue ? "1px" : undefined,
              opacity: done ? 0.78 : 1,
            }}
          >
            {/* alça esquerda */}
            <span
              onPointerDown={(e) => startDrag(e, t, "resize-l")}
              className="absolute left-0 top-0 h-full w-2.5 cursor-ew-resize rounded-l-full opacity-0 group-hover:opacity-100"
              style={{ background: "rgba(255,255,255,0.35)" }}
              aria-hidden
            />
            <span
              className={cn(
                "truncate text-[11px] font-medium",
                done ? "text-[color:var(--foreground)]/70 line-through" : "text-white/95",
              )}
            >
              {(g.endIdx - g.startIdx + 1) * pxDay >= 44
                ? groupBy === "responsavel"
                  ? t.titulo
                  : resp
                : ""}
            </span>
            {/* alça direita */}
            <span
              onPointerDown={(e) => startDrag(e, t, "resize-r")}
              className="absolute right-0 top-0 h-full w-2.5 cursor-ew-resize rounded-r-full opacity-0 group-hover:opacity-100"
              style={{ background: "rgba(255,255,255,0.35)" }}
              aria-hidden
            />
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            title={tip(t)}
            onPointerDown={(e) => startDrag(e, t, "move")}
            onClick={() => {
              if (movedRef.current) {
                movedRef.current = false;
                return;
              }
              setEditing(t);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") setEditing(t);
            }}
            onMouseEnter={() => setHoverId(t.id)}
            className="plano-focus absolute top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing touch-none flex flex-col items-center"
            style={{ left: (g.idx - domain.startIdx + 0.5) * pxDay - DIAMOND / 2 }}
          >
            <span
              className="block rotate-45 rounded-[3px]"
              style={{
                width: DIAMOND,
                height: DIAMOND,
                background: done
                  ? `color-mix(in oklab, ${color} 35%, var(--card))`
                  : `linear-gradient(135deg, color-mix(in oklab, ${color} 82%, #fff 18%), ${color})`,
                border: andamento && !done ? "2px solid var(--warm)" : "1px solid rgba(0,0,0,0.06)",
                boxShadow: overdue
                  ? "0 0 0 4px var(--urgent-bg)"
                  : done
                  ? "none"
                  : "0 1px 3px rgba(0,0,0,0.18)",
                opacity: done ? 0.6 : 1,
              }}
            />
            {isHover && (
              <span className="absolute top-[110%] whitespace-nowrap text-[9px] text-[color:var(--muted)] leading-none">
                {labelIdx(g.idx, "dd/MM")}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── render: coluna esquerda (status + título + pessoa/área) ──────────
  function renderLabel(t: Tarefa) {
    const done = isDone(t);
    const resp = responsavelOf(t);
    const area = frenteOf(t);
    const StatusIcon = done ? CheckCircle2 : t.status === "em_andamento" ? CircleDot : Circle;
    const statusColor = done
      ? "text-[color:var(--calm)]"
      : t.status === "em_andamento"
      ? "text-[color:var(--warm)]"
      : "text-[color:var(--muted)]";
    const statusTitle = done
      ? "Concluída — clique pra reabrir"
      : t.status === "em_andamento"
      ? "Em andamento — clique pra concluir"
      : "Aberta — clique pra marcar em andamento";

    return (
      <div
        style={{ width: LABEL_W }}
        className={cn(
          "relative shrink-0 sticky left-0 z-20 border-r border-[color:var(--border)] flex items-center gap-2 pr-2 group-hover/row:bg-[color:var(--accent)]/40 transition",
          rowDragId === t.id ? "bg-[color:var(--accent)]/70" : "bg-[color:var(--background)]",
          groupBy === "tarefa" ? "pl-1" : "pl-2.5",
        )}
      >
        {groupBy === "tarefa" && (
          <button
            type="button"
            onPointerDown={(e) => startRowDrag(e, t)}
            title="Arrastar pra reordenar"
            className="shrink-0 text-[color:var(--muted)]/45 hover:text-[color:var(--foreground)] cursor-grab active:cursor-grabbing touch-none plano-focus"
          >
            <GripVertical size={14} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={() => cycleStatus(t)}
          title={statusTitle}
          className={cn("shrink-0 plano-focus transition hover:scale-110", statusColor)}
        >
          <StatusIcon size={18} strokeWidth={2} />
        </button>

        <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5 py-1">
          {editTitle === t.id ? (
            <input
              type="text"
              defaultValue={t.titulo}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => saveTitle(t, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditTitle(null);
              }}
              className="w-full text-[12.5px] leading-tight px-1 py-0.5 rounded bg-[color:var(--card)] outline-none ring-1 ring-[color:var(--foreground)]/40 focus:ring-[color:var(--foreground)]"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditTitle(t.id)}
              title="Clique pra editar o título"
              className={cn(
                "text-left text-[12.5px] leading-tight truncate hover:text-[color:var(--foreground)]",
                done && "line-through text-[color:var(--muted)]",
              )}
            >
              {t.titulo}
            </button>
          )}

          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setPopover({ id: t.id, field: "pessoa", x: r.left, y: r.bottom + 4 });
              }}
              className="inline-flex items-center gap-1 text-[10px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] max-w-[110px]"
              title="Trocar responsável"
            >
              <UserRound size={10} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{resp}</span>
            </button>
            <span className="text-[color:var(--border)]">·</span>
            <button
              type="button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setPopover({ id: t.id, field: "area", x: r.left, y: r.bottom + 4 });
              }}
              className="inline-flex items-center gap-1 text-[10px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] max-w-[110px]"
              title="Trocar área"
            >
              <Tag size={9} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{area}</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setEditing(t)}
          title="Mais opções"
          className="shrink-0 opacity-0 group-hover/row:opacity-100 text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition p-1 plano-focus"
        >
          <Pencil size={13} strokeWidth={2} />
        </button>
      </div>
    );
  }

  // popover de edição (pessoa/área) — fixed, fora do container que corta o overflow
  function renderPopover() {
    if (!popover) return null;
    const t = byId.get(popover.id);
    if (!t) return null;
    const resp = responsavelOf(t);
    return (
      <>
        <div className="fixed inset-0 z-50" onClick={() => setPopover(null)} aria-hidden />
        <div
          className="fixed z-[51] w-56 max-h-72 overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-2xl p-1"
          style={{
            left: clamp(popover.x, 8, window.innerWidth - 232),
            // mantém o popover dentro da viewport verticalmente (vira pra cima se faltar espaço)
            top: clamp(popover.y, 8, Math.max(8, window.innerHeight - 296)),
          }}
        >
          {popover.field === "area" ? (
            <>
              <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                Área
              </p>
              <button
                type="button"
                onClick={() => setArea(t, null)}
                className="w-full text-left px-2 py-1.5 text-[12px] rounded-lg hover:bg-[color:var(--accent)]/60 text-[color:var(--muted)]"
              >
                — sem área —
              </button>
              {frentes.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setArea(t, f.id)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 text-[12px] rounded-lg hover:bg-[color:var(--accent)]/60",
                    t.frente === f.nome && "bg-[color:var(--accent)] font-medium",
                  )}
                >
                  {f.nome}
                </button>
              ))}
            </>
          ) : (
            <>
              <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                Responsável
              </p>
              <button
                type="button"
                onClick={() => setResponsavel(t, null)}
                className={cn(
                  "w-full text-left px-2 py-1.5 text-[12px] rounded-lg hover:bg-[color:var(--accent)]/60",
                  t.acao === "executar" && "bg-[color:var(--accent)] font-medium",
                )}
              >
                Você (eu faço)
              </button>
              {pessoas
                .filter((p) => p.nome.toLowerCase() !== "vitor")
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setResponsavel(t, p.nome)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 text-[12px] rounded-lg hover:bg-[color:var(--accent)]/60",
                      resp === p.nome && "bg-[color:var(--accent)] font-medium",
                    )}
                  >
                    {p.nome}
                  </button>
                ))}
            </>
          )}
        </div>
      </>
    );
  }

  const hasRows = dated.length > 0;

  return (
    <div className="space-y-4">
      {/* controles */}
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={groupBy}
          onChange={setGroupBy}
          options={[
            ["frente", "Por área"],
            ["responsavel", "Por responsável"],
            ["tarefa", "Por tarefa"],
          ]}
        />
        <Seg
          value={zoom}
          onChange={setZoom}
          options={[
            ["dia", "Dia"],
            ["semana", "Semana"],
            ["mes", "Mês"],
          ]}
        />
        <div className="inline-flex items-center rounded-full border border-[color:var(--border)] overflow-hidden">
          <button
            type="button"
            onClick={() => scrollByPage(-1)}
            aria-label="Período anterior"
            className="p-1.5 text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] transition cursor-pointer"
          >
            <ChevronLeft size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => scrollToToday(true)}
            className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 border-x border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] transition cursor-pointer"
          >
            <Crosshair size={12} strokeWidth={2} />
            Hoje
          </button>
          <button
            type="button"
            onClick={() => scrollByPage(1)}
            aria-label="Próximo período"
            className="p-1.5 text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] transition cursor-pointer"
          >
            <ChevronRight size={14} strokeWidth={2} />
          </button>
        </div>

        {/* legenda */}
        <div className="hidden md:flex items-center gap-3 ml-2 text-[10px] text-[color:var(--muted)]">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-5 rounded-full bg-[color:var(--muted-strong)]" /> barra
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[color:var(--muted-strong)]" /> marco
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-5 rounded-full ring-2 ring-[color:var(--urgent)]" /> vencida
          </span>
        </div>

        <button
          type="button"
          onClick={() => setAdding(true)}
          className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] hover:opacity-90 transition cursor-pointer"
        >
          <ListChecks size={14} strokeWidth={2.5} />
          Gerenciar tarefas
        </button>

        <label className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted-strong)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="accent-[color:var(--calm)]"
          />
          mostrar concluídas
        </label>
      </div>

      {/* gaveta: tarefas sem data */}
      {undated.length > 0 && (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--accent)]/20">
          <button
            type="button"
            onClick={() => setTrayOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 cursor-pointer"
          >
            <Inbox size={15} className="text-[color:var(--muted)]" />
            <span className="text-[12px] font-medium">Sem data</span>
            <span className="text-[11px] text-[color:var(--muted)]">{undated.length}</span>
            <span className="text-[11px] text-[color:var(--muted)] hidden sm:inline">
              — defina um prazo pra colocar na linha do tempo
            </span>
            <ChevronDown size={15} className={cn("ml-auto transition", !trayOpen && "-rotate-90")} />
          </button>
          {trayOpen && (
            <div className="px-3 pb-3 flex flex-wrap gap-2">
              {undated.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] pl-3 pr-2 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="text-[12px] max-w-[200px] truncate text-left hover:underline cursor-pointer"
                  >
                    {t.titulo}
                  </button>
                  <input
                    type="date"
                    aria-label={`definir prazo de ${t.titulo}`}
                    onChange={(e) => patch(t.id, { prazo: dInputToIso(e.target.value, true) })}
                    className="text-[11px] bg-transparent border border-[color:var(--border)] rounded px-1.5 py-0.5 text-[color:var(--muted-strong)] cursor-pointer focus-visible:outline-2 focus-visible:outline-[color:var(--foreground)] focus-visible:outline-offset-1"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* linha do tempo */}
      {!hasRows ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] py-12 px-6 text-center">
          <p className="text-[14px] text-[color:var(--muted-strong)]">
            Nada com data no plano ainda.
          </p>
          <p className="text-[12px] text-[color:var(--muted)] mt-1">
            Clique em “＋ Adicionar tarefas” pra escolher o que entra — ou defina um prazo nas de “Sem data”.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[color:var(--border)] overflow-hidden bg-[color:var(--card)]/40">
          <div ref={scrollRef} className="overflow-auto max-h-[72vh] overscroll-contain">
            <div style={{ width: LABEL_W + timelineW, minWidth: "100%" }}>
              {/* cabeçalho: meses + régua adaptada ao zoom */}
              <div
                className="flex sticky top-0 z-30 bg-[color:var(--background)] border-b border-[color:var(--border)]"
                style={{ height: HEAD_H }}
              >
                <div
                  style={{ width: LABEL_W }}
                  className="shrink-0 sticky left-0 z-40 bg-[color:var(--background)] border-r border-[color:var(--border)] flex items-end px-3 pb-2.5"
                >
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--muted)]">
                    {groupBy === "frente" ? "Áreas" : groupBy === "responsavel" ? "Responsáveis" : "Tarefas"}
                  </span>
                </div>
                <div className="relative" style={{ width: timelineW }}>
                  {/* marcador HOJE: caret discreto na base da régua (sticky → sempre visível) */}
                  <div
                    className="absolute bottom-0 z-20 -translate-x-1/2 pointer-events-none"
                    title="Hoje"
                    style={{ left: (today - domain.startIdx) * pxDay + pxDay / 2 }}
                  >
                    <div
                      style={{
                        width: 0,
                        height: 0,
                        borderLeft: "5px solid transparent",
                        borderRight: "5px solid transparent",
                        borderTop: "6px solid var(--urgent)",
                      }}
                    />
                  </div>

                  {/* FAIXA DE TOPO: mês (dia/semana) ou ano (mês). Flex + rótulo sticky:
                      o rótulo do período visível gruda à esquerda em vez de sumir ao rolar. */}
                  <div className="absolute top-0 left-0 flex" style={{ height: MONTH_H, width: timelineW }}>
                    {(zoom === "mes"
                      ? yearCells.map((y) => ({ key: y.startIdx, days: y.days, label: y.year }))
                      : months.map((mo) => ({ key: mo.startIdx, days: mo.days, label: mo.label }))
                    ).map((seg) => (
                      <div
                        key={seg.key}
                        className="h-full shrink-0 border-l border-b border-[color:var(--border)] bg-[color:var(--accent)]/25 flex items-center"
                        style={{ width: seg.days * pxDay }}
                      >
                        <span
                          className="sticky font-display italic text-[14px] leading-none text-[color:var(--muted-strong)] capitalize whitespace-nowrap px-2.5"
                          style={{ left: LABEL_W }}
                        >
                          {seg.label}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* LINHA INFERIOR: unidade do zoom */}
                  {zoom === "dia" &&
                    ticks.map((tk) => (
                      <div
                        key={tk.idx}
                        className={cn(
                          "absolute bottom-0 flex flex-col items-center justify-end border-l",
                          tk.isWeekStart
                            ? "border-[color:var(--border)]"
                            : tk.isSunday
                            ? "border-[color:var(--border)]/50"
                            : "border-[color:var(--border)]/25",
                        )}
                        style={{ left: tk.offset * pxDay, width: pxDay, height: HEAD_H - MONTH_H }}
                      >
                        <span
                          className={cn(
                            "text-[9px] uppercase tracking-[0.08em] mb-1",
                            tk.isWeekend ? "text-[color:var(--muted)]/60" : "text-[color:var(--muted)]",
                          )}
                        >
                          {tk.wd}
                        </span>
                        <span
                          className={cn(
                            "text-[16px] tabular-nums pb-2",
                            tk.isWeekStart
                              ? "text-[color:var(--foreground)] font-semibold"
                              : tk.isWeekend
                              ? "text-[color:var(--muted)]/70"
                              : "text-[color:var(--muted-strong)]",
                          )}
                        >
                          {tk.dom}
                        </span>
                      </div>
                    ))}

                  {zoom === "semana" &&
                    weekCells.map((wc) => (
                      <div
                        key={wc.startIdx}
                        className="absolute bottom-0 flex items-end border-l border-[color:var(--border)]"
                        style={{ left: wc.offset * pxDay, width: wc.days * pxDay, height: HEAD_H - MONTH_H }}
                      >
                        <span className="pl-2.5 pb-2 text-[12.5px] tabular-nums whitespace-nowrap">
                          <span className="text-[color:var(--foreground)] font-semibold">
                            {labelIdx(wc.startIdx, "d")}
                          </span>
                          {wc.days > 1 && (
                            <span className="text-[color:var(--muted)]">
                              {" – "}
                              {labelIdx(wc.startIdx + wc.days - 1, "d")}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}

                  {zoom === "mes" &&
                    months.map((mo) => (
                      <div
                        key={mo.startIdx}
                        className="absolute bottom-0 flex items-end border-l border-[color:var(--border)]"
                        style={{
                          left: (mo.startIdx - domain.startIdx) * pxDay,
                          width: mo.days * pxDay,
                          height: HEAD_H - MONTH_H,
                        }}
                      >
                        <span className="pl-2.5 pb-2 font-display italic text-[15px] text-[color:var(--foreground)] capitalize truncate">
                          {mo.label.replace(/\s+\d{4}$/, "")}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* corpo */}
              <div className="relative">
                {/* camada de fundo: fim de semana + grade (só na área da timeline) */}
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: LABEL_W, width: timelineW }}
                  aria-hidden
                >
                  {weekends.map((w, i) => (
                    <div
                      key={`we-${i}`}
                      className="absolute top-0 bottom-0 bg-[color:var(--accent)]/35"
                      style={{ left: w.startOffset * pxDay, width: w.days * pxDay }}
                    />
                  ))}
                  {ticks.map((tk) =>
                    zoom === "dia" || tk.isWeekStart || tk.isSunday ? (
                      <div
                        key={`grid-${tk.idx}`}
                        className="absolute top-0 bottom-0 w-px"
                        style={{
                          left: tk.offset * pxDay,
                          background: tk.isWeekStart
                            ? "color-mix(in oklab, var(--border) 70%, transparent)"
                            : "color-mix(in oklab, var(--border) 35%, transparent)",
                        }}
                      />
                    ) : null,
                  )}
                </div>

                {/* linha vertical HOJE — fina e discreta (o caret no cabeçalho marca o dia) */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-[color:var(--urgent)]/45 z-[15] pointer-events-none"
                  style={{ left: todayLeft }}
                  aria-hidden
                />

                {groups.map((grp, gi) => (
                  <div key={grp.key}>
                    {groupBy !== "tarefa" && (
                      <div
                        className="flex items-stretch border-b border-[color:var(--border)]"
                        style={{ height: GROUP_H }}
                      >
                        <button
                          type="button"
                          onClick={() => setCollapsed((c) => ({ ...c, [grp.key]: !c[grp.key] }))}
                          style={{ width: LABEL_W }}
                          className="shrink-0 sticky left-0 z-20 bg-[color:var(--accent)]/70 border-r border-[color:var(--border)] flex items-center gap-1.5 px-2.5 text-left cursor-pointer hover:bg-[color:var(--accent)]/90 transition"
                        >
                          <ChevronDown
                            size={13}
                            className={cn("transition shrink-0", collapsed[grp.key] && "-rotate-90")}
                          />
                          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] truncate">
                            {grp.key}
                          </span>
                          <span className="ml-auto text-[10px] text-[color:var(--muted)] tabular-nums">
                            {grp.items.length}
                          </span>
                        </button>
                        <div className="relative" style={{ width: timelineW }} />
                      </div>
                    )}
                    {(groupBy === "tarefa" || !collapsed[grp.key]) &&
                      grp.items.map((t, i) => (
                        <div
                          key={t.id}
                          className={cn(
                            "group/row flex items-stretch border-b border-[color:var(--border)]/60 plano-rise",
                            rowDragId === t.id
                              ? "relative z-[6] bg-[color:var(--accent)]/40 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.3)]"
                              : "hover:bg-[color:var(--accent)]/20",
                          )}
                          style={{ height: ROW_H, animationDelay: `${(gi * 4 + i) * 22}ms` }}
                          onMouseEnter={() => setHoverId(t.id)}
                          onMouseLeave={() => setHoverId((h) => (h === t.id ? null : h))}
                        >
                          {renderLabel(t)}
                          {renderTrack(t)}
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {renderPopover()}
      {editing && <TaskEditModal tarefa={editing} onClose={() => setEditing(null)} />}
      {adding && (
        <PlanoManageModal tarefas={tarefas} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

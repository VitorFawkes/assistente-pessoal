"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Search, X, Check, ChevronDown, CalendarClock, Mic, UserRound } from "lucide-react";
import { cn, formatPrazo } from "@/lib/utils";
import type { Tarefa } from "@/lib/queries";
import {
  applyFacets,
  matchesSearch,
  countBy,
  sortTarefas,
  personNamesOf,
  areaOf,
  reuniaoOf,
  principalPersonOf,
  dateInRange,
  type Facets,
  type SortKey,
  type MeetingDateBucket,
} from "@/lib/task-filters";

type Props = {
  quadroId: string;
  onClose: () => void;
  onAdded: () => void;
};

const PRIO_LABEL: Record<string, string> = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};
const MEETING_BUCKETS: { k: MeetingDateBucket; label: string }[] = [
  { k: "qualquer", label: "Qualquer" },
  { k: "hoje", label: "Hoje" },
  { k: "semana", label: "Esta semana" },
  { k: "mes", label: "Este mês" },
  { k: "antigas", label: "Mais antigas" },
];
const SORTS: { k: SortKey; label: string }[] = [
  { k: "prazo", label: "Prazo" },
  { k: "criacao_desc", label: "Mais recentes" },
  { k: "reuniao_desc", label: "Reunião ↓" },
  { k: "prioridade", label: "Prioridade" },
];

type Opt = { value: string; label: string; count: number };

// Dropdown multiselect compacto com contagem.
function FacetDropdown({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Opt[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const n = selected.size;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-full border transition whitespace-nowrap",
          n > 0
            ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)]"
            : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
        )}
      >
        {label}
        {n > 0 && <span className="opacity-80">· {n}</span>}
        <ChevronDown size={12} className={cn("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-56 max-h-72 overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-1.5">
          {options.length === 0 ? (
            <p className="text-[12px] text-[color:var(--muted)] px-2 py-2">nada aqui</p>
          ) : (
            options.map((o) => {
              const on = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onToggle(o.value)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[13px] hover:bg-[color:var(--accent)]/50"
                >
                  <span
                    className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                      on
                        ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
                        : "border-[color:var(--muted)]/60",
                    )}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{o.label}</span>
                  <span className="text-[11px] text-[color:var(--muted)]">{o.count}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function TaskPickerModal({ quadroId, onClose, onAdded }: Props) {
  const [candidatas, setCandidatas] = useState<Tarefa[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const [search, setSearch] = useState("");
  const [selPessoas, setSelPessoas] = useState<Set<string>>(new Set());
  const [selAreas, setSelAreas] = useState<Set<string>>(new Set());
  const [selPrioridades, setSelPrioridades] = useState<Set<string>>(new Set());
  const [selReunioes, setSelReunioes] = useState<Set<string>>(new Set());
  const [meetingDate, setMeetingDate] = useState<MeetingDateBucket>("qualquer");
  const [prazoFrom, setPrazoFrom] = useState("");
  const [prazoTo, setPrazoTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("criacao_desc");
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    fetch(`/api/quadros/${quadroId}/tarefas`)
      .then((r) => r.json())
      .then((d: { candidatas?: Tarefa[] }) => setCandidatas(d.candidatas ?? []))
      .catch(() => toast.error("Erro ao carregar tarefas"))
      .finally(() => setLoading(false));
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [quadroId, onClose]);

  // Base: só a busca textual aplicada (opções e contagens vêm daqui).
  const base = useMemo(
    () => (search.trim() ? candidatas.filter((t) => matchesSearch(t, search)) : candidatas),
    [candidatas, search],
  );

  // Chave de reunião estável (meeting_id) + rótulo legível.
  const meetingKey = (t: Tarefa) => t.meeting_id ?? "sem";

  const pessoaOpts: Opt[] = useMemo(() => {
    const c = countBy(base, personNamesOf);
    return [...c.entries()]
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  }, [base]);

  const areaOpts: Opt[] = useMemo(() => {
    const c = countBy(base, (t) => [areaOf(t)]);
    return [...c.entries()]
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  }, [base]);

  const prioOpts: Opt[] = useMemo(() => {
    const c = countBy(base, (t) => [t.prioridade]);
    return (["urgente", "alta", "media", "baixa"] as const)
      .map((v) => ({ value: v, label: PRIO_LABEL[v], count: c.get(v) ?? 0 }))
      .filter((o) => o.count > 0);
  }, [base]);

  const reuniaoOpts: Opt[] = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const t of base) {
      const k = meetingKey(t);
      const g = m.get(k);
      if (g) g.count++;
      else m.set(k, { label: reuniaoOf(t), count: 1 });
    }
    return [...m.entries()]
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => {
        if (a.value === "sem") return 1;
        if (b.value === "sem") return -1;
        return b.count - a.count;
      });
  }, [base]);

  const filtered = useMemo(() => {
    const facets: Facets = {
      pessoas: selPessoas,
      areas: selAreas,
      meetingDate,
      prioridades: selPrioridades,
      tipos: new Set(),
    };
    let l = applyFacets(base, facets);
    if (selReunioes.size) l = l.filter((t) => selReunioes.has(meetingKey(t)));
    if (prazoFrom || prazoTo) l = l.filter((t) => dateInRange(t.prazo, prazoFrom, prazoTo));
    return sortTarefas(l, sortKey);
  }, [base, selPessoas, selAreas, meetingDate, selPrioridades, selReunioes, prazoFrom, prazoTo, sortKey]);

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const toggleSel = (id: string) => toggleIn(setSel, id);
  const allVisibleOn = filtered.length > 0 && filtered.every((t) => sel.has(t.id));
  const toggleAllVisible = () =>
    setSel((prev) => {
      const next = new Set(prev);
      if (allVisibleOn) filtered.forEach((t) => next.delete(t.id));
      else filtered.forEach((t) => next.add(t.id));
      return next;
    });

  const activeFilters =
    selPessoas.size + selAreas.size + selPrioridades.size + selReunioes.size +
    (meetingDate !== "qualquer" ? 1 : 0) + (prazoFrom || prazoTo ? 1 : 0);
  const clearFilters = () => {
    setSelPessoas(new Set());
    setSelAreas(new Set());
    setSelPrioridades(new Set());
    setSelReunioes(new Set());
    setMeetingDate("qualquer");
    setPrazoFrom("");
    setPrazoTo("");
    setSearch("");
  };

  async function adicionar() {
    const ids = [...sel];
    if (ids.length === 0) return;
    setAdding(true);
    try {
      const r = await fetch(`/api/quadros/${quadroId}/tarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarefaIds: ids }),
      });
      if (!r.ok) throw new Error("Erro ao adicionar");
      toast.success(`${ids.length} tarefa${ids.length > 1 ? "s" : ""} adicionada${ids.length > 1 ? "s" : ""}`);
      onAdded();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
      setAdding(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-2xl bg-[color:var(--card)] border border-[color:var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-display text-xl">Adicionar tarefas ao quadro</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
            <X size={18} />
          </button>
        </div>

        {/* Busca + filtros */}
        <div className="px-5 space-y-2.5">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-[color:var(--border)]">
            <Search size={14} className="text-[color:var(--muted)] shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, pessoa, área, reunião…"
              className="flex-1 bg-transparent text-sm outline-none"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <FacetDropdown label="Pessoa" options={pessoaOpts} selected={selPessoas} onToggle={(v) => toggleIn(setSelPessoas, v)} />
            <FacetDropdown label="Reunião" options={reuniaoOpts} selected={selReunioes} onToggle={(v) => toggleIn(setSelReunioes, v)} />
            <FacetDropdown label="Área" options={areaOpts} selected={selAreas} onToggle={(v) => toggleIn(setSelAreas, v)} />
            <FacetDropdown label="Prioridade" options={prioOpts} selected={selPrioridades} onToggle={(v) => toggleIn(setSelPrioridades, v)} />
            <select
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value as MeetingDateBucket)}
              title="Data da reunião"
              className="text-[12px] px-2.5 py-1.5 rounded-full border border-[color:var(--border)] bg-transparent text-[color:var(--muted-strong)]"
            >
              {MEETING_BUCKETS.map((b) => (
                <option key={b.k} value={b.k}>Reunião: {b.label}</option>
              ))}
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              title="Ordenar"
              className="text-[12px] px-2.5 py-1.5 rounded-full border border-[color:var(--border)] bg-transparent text-[color:var(--muted-strong)]"
            >
              {SORTS.map((s) => (
                <option key={s.k} value={s.k}>Ordenar: {s.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-[color:var(--muted)]">Prazo:</span>
            <input type="date" value={prazoFrom} onChange={(e) => setPrazoFrom(e.target.value)} className="px-2 py-1 rounded border border-[color:var(--border)] bg-transparent" />
            <span className="text-[color:var(--muted)]">até</span>
            <input type="date" value={prazoTo} onChange={(e) => setPrazoTo(e.target.value)} className="px-2 py-1 rounded border border-[color:var(--border)] bg-transparent" />
            {activeFilters > 0 && (
              <button type="button" onClick={clearFilters} className="ml-auto text-[color:var(--muted)] hover:text-[color:var(--urgent)] underline underline-offset-2">
                limpar filtros
              </button>
            )}
          </div>
        </div>

        {/* Lista */}
        <div className="flex items-center justify-between px-5 pt-3 pb-1.5">
          <button type="button" onClick={toggleAllVisible} disabled={filtered.length === 0} className="text-[12px] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] disabled:opacity-40">
            {allVisibleOn ? "Desmarcar visíveis" : "Selecionar visíveis"} ({filtered.length})
          </button>
          {sel.size > 0 && <span className="text-[12px] text-[color:var(--muted)]">{sel.size} selecionada{sel.size > 1 ? "s" : ""}</span>}
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-1.5 min-h-[120px]">
          {loading ? (
            <p className="text-sm text-[color:var(--muted)] py-10 text-center">Carregando…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[color:var(--muted)] py-10 text-center">
              {candidatas.length === 0 ? "Nenhuma tarefa aberta fora deste quadro." : "Nenhuma tarefa bate nos filtros."}
            </p>
          ) : (
            filtered.map((t) => {
              const prazo = formatPrazo(t.prazo);
              const on = sel.has(t.id);
              const pessoa = principalPersonOf(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleSel(t.id)}
                  className={cn(
                    "w-full flex items-start gap-2.5 text-left px-3 py-2.5 rounded-xl border transition",
                    on
                      ? "border-[color:var(--foreground)] bg-[color:var(--accent)]/40"
                      : "border-[color:var(--border)] hover:bg-[color:var(--accent)]/30",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0",
                      on
                        ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
                        : "border-[color:var(--muted)]/60",
                    )}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-[color:var(--foreground)] truncate">{t.titulo}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[color:var(--muted)]">
                      {t.prazo && (
                        <span className="inline-flex items-center gap-0.5">
                          <CalendarClock size={10} /> {prazo.text}
                        </span>
                      )}
                      {pessoa && (
                        <span className="inline-flex items-center gap-0.5">
                          <UserRound size={10} /> {pessoa}
                        </span>
                      )}
                      {areaOf(t) !== "Sem área" && (
                        <span className="px-1.5 py-0.5 rounded bg-[color:var(--accent)] text-[color:var(--muted-strong)]">{areaOf(t)}</span>
                      )}
                      {t.meeting_id && (
                        <span className="inline-flex items-center gap-0.5 max-w-[200px] truncate">
                          <Mic size={10} /> {t.meeting_summary || "reunião"}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[color:var(--border)]">
          <button type="button" onClick={onClose} className="text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)] px-3 py-1.5">
            Cancelar
          </button>
          <button
            type="button"
            onClick={adicionar}
            disabled={sel.size === 0 || adding}
            className="rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {adding ? "Adicionando…" : `Adicionar${sel.size > 0 ? ` (${sel.size})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

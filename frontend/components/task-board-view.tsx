"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn, nowSP, toSP } from "@/lib/utils";
import type { Tarefa } from "@/lib/queries";
import { TaskRow } from "./task-row";
import { FacetDropdown, type Opt } from "./facet-dropdown";
import {
  applyFacets,
  matchesSearch,
  countBy,
  sortTarefas,
  personNamesOf,
  areaOf,
  reuniaoOf,
  principalPersonOf,
  type Facets,
  type SortKey,
} from "@/lib/task-filters";

type GroupMode = "nenhum" | "pessoa" | "area" | "reuniao" | "prazo";
type StatusView = "abertas" | "concluidas" | "todas";

const PRIO_LABEL: Record<string, string> = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};
const STATUS_OPTS: { k: StatusView; label: string }[] = [
  { k: "abertas", label: "Ver: abertas" },
  { k: "concluidas", label: "Ver: concluídas" },
  { k: "todas", label: "Ver: todas" },
];
const GROUP_OPTS: { k: GroupMode; label: string }[] = [
  { k: "nenhum", label: "Agrupar: não" },
  { k: "pessoa", label: "Agrupar: pessoa" },
  { k: "prazo", label: "Agrupar: prazo" },
  { k: "area", label: "Agrupar: área" },
  { k: "reuniao", label: "Agrupar: reunião" },
];
const SORT_OPTS: { k: SortKey; label: string }[] = [
  { k: "prazo", label: "Ordenar: prazo" },
  { k: "criacao_desc", label: "Ordenar: mais recentes" },
  { k: "prioridade", label: "Ordenar: prioridade" },
  { k: "reuniao_desc", label: "Ordenar: reunião" },
];

// Agrupa por prazo em baldes ordenados (vencidas → sem prazo).
function groupByPrazo(list: Tarefa[]): [string, Tarefa[]][] {
  const now = nowSP();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const endWeek = new Date(now);
  endWeek.setDate(endWeek.getDate() + ((7 - now.getDay()) % 7));
  endWeek.setHours(23, 59, 59, 999);
  const buckets: Record<string, Tarefa[]> = {
    Vencidas: [], Hoje: [], "Esta semana": [], "Mais adiante": [], "Sem prazo": [],
  };
  for (const t of list) {
    if (!t.prazo) { buckets["Sem prazo"].push(t); continue; }
    const p = toSP(t.prazo);
    if (Number.isNaN(p.getTime())) { buckets["Sem prazo"].push(t); continue; }
    if (p < startToday) buckets["Vencidas"].push(t);
    else if (p <= endToday) buckets["Hoje"].push(t);
    else if (p <= endWeek) buckets["Esta semana"].push(t);
    else buckets["Mais adiante"].push(t);
  }
  return (["Vencidas", "Hoje", "Esta semana", "Mais adiante", "Sem prazo"] as const)
    .map((k) => [k, buckets[k]] as [string, Tarefa[]])
    .filter(([, items]) => items.length > 0);
}

export function TaskBoardView({
  tarefas,
  onRemoveFromBoard,
}: {
  tarefas: Tarefa[];
  onRemoveFromBoard: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [statusView, setStatusView] = useState<StatusView>("abertas");
  const [selPessoas, setSelPessoas] = useState<Set<string>>(new Set());
  const [selAreas, setSelAreas] = useState<Set<string>>(new Set());
  const [selPrioridades, setSelPrioridades] = useState<Set<string>>(new Set());
  const [groupMode, setGroupMode] = useState<GroupMode>("nenhum");
  const [sortKey, setSortKey] = useState<SortKey>("prazo");

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  // base = status + busca (opções e contagens das facetas saem daqui)
  const base = useMemo(() => {
    let l = tarefas;
    if (statusView === "abertas")
      l = l.filter((t) => t.status === "aberta" || t.status === "em_andamento");
    else if (statusView === "concluidas")
      l = l.filter((t) => t.status === "concluida" || t.status === "cancelada");
    if (search.trim()) l = l.filter((t) => matchesSearch(t, search));
    return l;
  }, [tarefas, statusView, search]);

  const facets: Facets = useMemo(
    () => ({
      pessoas: selPessoas,
      areas: selAreas,
      meetingDate: "qualquer",
      prioridades: selPrioridades,
      tipos: new Set(),
    }),
    [selPessoas, selAreas, selPrioridades],
  );

  const filtered = useMemo(
    () => sortTarefas(applyFacets(base, facets), sortKey),
    [base, facets, sortKey],
  );

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

  const groups: [string, Tarefa[]][] = useMemo(() => {
    if (groupMode === "nenhum") return [["", filtered]];
    if (groupMode === "prazo") return groupByPrazo(filtered);
    const keyFn =
      groupMode === "pessoa" ? principalPersonOf : groupMode === "area" ? areaOf : reuniaoOf;
    const m = new Map<string, Tarefa[]>();
    for (const t of filtered) {
      const k = keyFn(t);
      (m.get(k) ?? m.set(k, []).get(k)!).push(t);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "pt-BR"));
  }, [filtered, groupMode]);

  const activeFilters = selPessoas.size + selAreas.size + selPrioridades.size;
  const clearAll = () => {
    setSelPessoas(new Set());
    setSelAreas(new Set());
    setSelPrioridades(new Set());
    setSearch("");
  };

  const selectCls =
    "text-[12px] px-2.5 py-1.5 rounded-full border border-[color:var(--border)] bg-transparent text-[color:var(--muted-strong)] cursor-pointer hover:bg-[color:var(--accent)]";

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-[color:var(--border)]">
          <Search size={14} className="text-[color:var(--muted)] shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nas tarefas do quadro…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={statusView} onChange={(e) => setStatusView(e.target.value as StatusView)} className={selectCls}>
            {STATUS_OPTS.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
          </select>
          <FacetDropdown label="Pessoa" options={pessoaOpts} selected={selPessoas} onToggle={(v) => toggleIn(setSelPessoas, v)} />
          <FacetDropdown label="Área" options={areaOpts} selected={selAreas} onToggle={(v) => toggleIn(setSelAreas, v)} />
          <FacetDropdown label="Prioridade" options={prioOpts} selected={selPrioridades} onToggle={(v) => toggleIn(setSelPrioridades, v)} />
          <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)} className={selectCls}>
            {GROUP_OPTS.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className={selectCls}>
            {SORT_OPTS.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
          </select>
          {(activeFilters > 0 || search) && (
            <button type="button" onClick={clearAll} className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--urgent)] underline underline-offset-2">
              limpar
            </button>
          )}
        </div>
      </div>

      {/* Lista (agrupada ou flat) */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] py-10 px-6 text-center">
          <p className="text-sm text-[color:var(--muted-strong)]">
            {tarefas.length === 0 ? "Nenhuma tarefa neste quadro ainda." : "Nenhuma tarefa bate nos filtros."}
          </p>
          {tarefas.length === 0 && (
            <p className="text-xs text-[color:var(--muted)] mt-1">Crie uma acima, ou adicione tarefas que já existem.</p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([label, items]) => (
            <div key={label || "all"} className="space-y-2.5">
              {label && (
                <div className="flex items-center gap-2">
                  <h4 className="text-[11px] tracking-[0.2em] uppercase font-semibold text-[color:var(--muted-strong)]">{label}</h4>
                  <span className="text-[11px] text-[color:var(--muted)]">{items.length}</span>
                </div>
              )}
              <div className="flex flex-col gap-2.5">
                {items.map((t) => (
                  <div key={t.id} className="group relative">
                    <TaskRow tarefa={t} />
                    <button
                      type="button"
                      onClick={() => onRemoveFromBoard(t.id)}
                      title="Remover do quadro"
                      className="absolute -top-2 right-2 z-10 text-[10px] tracking-wide px-2 py-0.5 rounded-full border border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--muted)] opacity-0 group-hover:opacity-100 hover:text-[color:var(--urgent)] hover:border-[color:var(--urgent)]/40 transition"
                    >
                      remover do quadro
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Flame, Check, Search, X } from "lucide-react";
import { TaskRow, type Tarefa } from "./task-row";
import { TaskCreateModal } from "./task-create-modal";
import { CaptureComposer } from "./capture-composer";
import { Tabs } from "./tabs";
import { FiltersPanel, type GroupMode, type Option } from "./filters-panel";
import { ActiveFilters, type ActiveChip } from "./active-filters";
import { BulkActionBar } from "./bulk-action-bar";
import { DateFilter, filterByDate, type DateBucket } from "./date-filter";
import { filterByCreated, type CreatedBucket } from "./created-filter";
import {
  applyFacets,
  countBy,
  activeFacetCount,
  matchesSearch,
  inMeetingDate,
  dateInRange,
  personNamesOf,
  areaOf,
  tipoOf,
  principalPersonOf,
  sortTarefas,
  type Facets,
  type MeetingDateBucket,
  type SortKey,
} from "@/lib/task-filters";
import { cn, nowSP, toSP } from "@/lib/utils";

type GroupKey = "vencidas" | "hoje" | "esta_semana" | "futuro" | "sem_prazo";

const GROUP_LABELS: Record<GroupKey, string> = {
  vencidas: "Vencidas",
  hoje: "Hoje",
  esta_semana: "Esta semana",
  futuro: "Mais adiante",
  sem_prazo: "Sem prazo",
};

const GROUP_ACCENT: Record<GroupKey, string> = {
  vencidas: "text-[color:var(--urgent)]",
  hoje: "text-[color:var(--warm)]",
  esta_semana: "text-[color:var(--muted-strong)]",
  futuro: "text-[color:var(--muted)]",
  sem_prazo: "text-[color:var(--muted)]",
};

const PRIORIDADE_LABEL: Record<string, string> = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

const MEETING_DATE_LABEL: Record<MeetingDateBucket, string> = {
  qualquer: "Qualquer",
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
  antigas: "Mais antigas",
};

const CREATED_LABEL: Record<CreatedBucket, string> = {
  todas: "Qualquer",
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
};

const GROUPMODE_LABEL: Record<GroupMode, string> = {
  prazo: "Prazo",
  frente: "Área",
  pessoa: "Pessoa",
  reuniao: "Reunião",
  nenhum: "Nenhum",
};

const SORT_LABEL: Record<SortKey, string> = {
  prazo: "Prazo",
  criacao_desc: "Criação ↓",
  criacao_asc: "Criação ↑",
  reuniao_desc: "Reunião ↓",
  prioridade: "Prioridade",
};

type DateRangeState = { from: string; to: string };
const EMPTY_RANGE: DateRangeState = { from: "", to: "" };

// "2026-06-15" → "15/06"
const shortDate = (d: string) => {
  const [, m, day] = d.split("-");
  return day && m ? `${day}/${m}` : d;
};
const rangeLabel = (r: DateRangeState) => {
  if (r.from && r.to) return `${shortDate(r.from)}–${shortDate(r.to)}`;
  if (r.from) return `desde ${shortDate(r.from)}`;
  return `até ${shortDate(r.to)}`;
};

function groupByPrazo(tarefas: Tarefa[]): Record<GroupKey, Tarefa[]> {
  const now = nowSP();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const endWeek = new Date(now);
  endWeek.setDate(endWeek.getDate() + ((7 - now.getDay()) % 7));
  endWeek.setHours(23, 59, 59, 999);

  const out: Record<GroupKey, Tarefa[]> = {
    vencidas: [],
    hoje: [],
    esta_semana: [],
    futuro: [],
    sem_prazo: [],
  };

  for (const t of tarefas) {
    if (!t.prazo) {
      out.sem_prazo.push(t);
      continue;
    }
    const p = toSP(t.prazo);
    if (Number.isNaN(p.getTime())) {
      out.sem_prazo.push(t);
      continue;
    }
    if (p < startToday) out.vencidas.push(t);
    else if (p <= endToday) out.hoje.push(t);
    else if (p <= endWeek) out.esta_semana.push(t);
    else out.futuro.push(t);
  }
  return out;
}

const PRAZO_ORDER: GroupKey[] = [
  "vencidas",
  "hoje",
  "esta_semana",
  "futuro",
  "sem_prazo",
];

// Agrupa por área, ordena A→Z ("Sem área" por último).
function groupByFrente(list: Tarefa[]): [string, Tarefa[]][] {
  const map = new Map<string, Tarefa[]>();
  for (const t of list) {
    const key = areaOf(t);
    (map.get(key) ?? map.set(key, []).get(key)!).push(t);
  }
  return [...map.entries()]
    .map(([k, items]) => [k, items] as [string, Tarefa[]])
    .sort((a, b) => {
      if (a[0] === "Sem área") return 1;
      if (b[0] === "Sem área") return -1;
      return a[0].localeCompare(b[0], "pt-BR");
    });
}

// Agrupa por pessoa (principal). "Você" primeiro, depois por volume.
function groupByPessoa(list: Tarefa[]): [string, Tarefa[]][] {
  const map = new Map<string, Tarefa[]>();
  for (const t of list) {
    const key = principalPersonOf(t);
    (map.get(key) ?? map.set(key, []).get(key)!).push(t);
  }
  return [...map.entries()]
    .map(([k, items]) => [k, items] as [string, Tarefa[]])
    .sort((a, b) => {
      if (a[0] === "Você") return -1;
      if (b[0] === "Você") return 1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0], "pt-BR");
    });
}

// Agrupa por reunião de origem (chave = meeting_id, p/ reuniões distintas sem
// resumo não se fundirem), mais recentes primeiro ("Sem reunião" por último).
function groupByReuniao(list: Tarefa[]): [string, Tarefa[]][] {
  const map = new Map<string, { label: string; date: string; items: Tarefa[] }>();
  for (const t of list) {
    const key = t.meeting_id ?? "sem";
    let g = map.get(key);
    if (!g) {
      const label = t.meeting_id
        ? t.meeting_summary?.trim() || "Reunião sem resumo"
        : "Sem reunião";
      g = { label, date: t.meeting_recorded_at ?? "", items: [] };
      map.set(key, g);
    }
    g.items.push(t);
  }
  return [...map.values()]
    .sort((a, b) => {
      if (a.label === "Sem reunião") return 1;
      if (b.label === "Sem reunião") return -1;
      return b.date.localeCompare(a.date);
    })
    .map((g) => [g.label, g.items] as [string, Tarefa[]]);
}

// Checkbox que seleciona/desmarca um grupo inteiro de uma vez.
function GroupSelectBox({
  ids,
  selected,
  onToggle,
}: {
  ids: string[];
  selected: Set<string>;
  onToggle: (ids: string[]) => void;
}) {
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const someOn = ids.some((id) => selected.has(id));
  return (
    <button
      type="button"
      onClick={() => onToggle(ids)}
      aria-label={allOn ? "Desmarcar grupo" : "Selecionar grupo"}
      className="shrink-0"
    >
      <span
        className={cn(
          "w-4 h-4 rounded border flex items-center justify-center transition",
          allOn
            ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
            : someOn
            ? "border-[color:var(--foreground)] text-[color:var(--foreground)]"
            : "border-[color:var(--muted)]/60 text-transparent hover:border-[color:var(--muted-strong)]",
        )}
      >
        <Check size={11} strokeWidth={3} className={cn(!allOn && someOn && "opacity-60")} />
      </span>
    </button>
  );
}

function GroupHeader({
  label,
  count,
  accent,
  ids,
  selected,
  onToggleGroup,
}: {
  label: string;
  count: number;
  accent: string;
  ids: string[];
  selected: Set<string>;
  onToggleGroup: (ids: string[]) => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <GroupSelectBox ids={ids} selected={selected} onToggle={onToggleGroup} />
      <h3
        className={cn("text-[11px] tracking-[0.2em] uppercase font-semibold truncate", accent)}
      >
        {label}
      </h3>
      <span className="text-[11px] text-[color:var(--muted)]">{count}</span>
    </div>
  );
}

const isUrgentish = (t: Tarefa) =>
  t.prioridade === "urgente" || t.prioridade === "alta";

export function TasksDashboard({ tarefas }: { tarefas: Tarefa[] }) {
  const [bucket, setBucket] = useState<DateBucket>("todos");
  const [createdBucket, setCreatedBucket] = useState<CreatedBucket>("todas");
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [search, setSearch] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("prazo");
  const [sortKey, setSortKey] = useState<SortKey>("prazo");
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState("todas");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);

  // Facetas
  const [selPessoas, setSelPessoas] = useState<Set<string>>(new Set());
  const [selAreas, setSelAreas] = useState<Set<string>>(new Set());
  const [meetingDate, setMeetingDate] = useState<MeetingDateBucket>("qualquer");
  const [selPrioridades, setSelPrioridades] = useState<Set<string>>(new Set());
  const [selTipos, setSelTipos] = useState<Set<string>>(new Set());
  const [meetingRange, setMeetingRange] = useState<DateRangeState>(EMPTY_RANGE);
  const [createdRange, setCreatedRange] = useState<DateRangeState>(EMPTY_RANGE);

  // Áreas pro popover de "Área" da barra de ações em massa.
  useEffect(() => {
    fetch("/api/frentes")
      .then((r) => r.json())
      .then((d: { frentes?: { id: string; nome: string }[] }) =>
        setFrentes(d.frentes ?? []),
      )
      .catch(() => {});
  }, []);

  const counts = useMemo(() => {
    const bs: DateBucket[] = ["todos", "vencidas", "hoje", "semana", "mes", "sem_prazo"];
    return Object.fromEntries(
      bs.map((b) => [b, filterByDate(tarefas, b).length]),
    ) as Record<DateBucket, number>;
  }, [tarefas]);

  const createdCounts = useMemo(() => {
    const bs: CreatedBucket[] = ["todas", "hoje", "semana", "mes"];
    return Object.fromEntries(
      bs.map((b) => [b, filterByCreated(tarefas, b).length]),
    ) as Record<CreatedBucket, number>;
  }, [tarefas]);

  // Pré-filtros "globais" (prazo + criação + urgentes + busca) aplicados antes das facetas.
  const globalList = useMemo(() => {
    let l = filterByDate(tarefas, bucket);
    if (createdRange.from || createdRange.to)
      l = l.filter((t) => dateInRange(t.created_at, createdRange.from, createdRange.to));
    else l = filterByCreated(l, createdBucket);
    if (onlyUrgent) l = l.filter(isUrgentish);
    if (search.trim()) l = l.filter((t) => matchesSearch(t, search));
    return l;
  }, [tarefas, bucket, createdBucket, createdRange, onlyUrgent, search]);

  const facets: Facets = useMemo(
    () => ({
      pessoas: selPessoas,
      areas: selAreas,
      meetingDate,
      meetingFrom: meetingRange.from,
      meetingTo: meetingRange.to,
      prioridades: selPrioridades,
      tipos: selTipos,
    }),
    [selPessoas, selAreas, meetingDate, meetingRange, selPrioridades, selTipos],
  );

  const filtered = useMemo(
    () => applyFacets(globalList, facets),
    [globalList, facets],
  );

  // ─── Opções de faceta com contagem ao vivo (excluindo a própria faceta) ──
  const pessoaOptions: Option[] = useMemo(() => {
    const c = countBy(applyFacets(globalList, facets, "pessoas"), personNamesOf);
    return [...c.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "pt-BR"));
  }, [globalList, facets]);

  const areaOptions: Option[] = useMemo(() => {
    const c = countBy(applyFacets(globalList, facets, "areas"), (t) => [areaOf(t)]);
    return [...c.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => {
        if (a.value === "Sem área") return 1;
        if (b.value === "Sem área") return -1;
        return b.count - a.count || a.value.localeCompare(b.value, "pt-BR");
      });
  }, [globalList, facets]);

  const prioridadeOptions: Option[] = useMemo(() => {
    const c = countBy(applyFacets(globalList, facets, "prioridades"), (t) => [t.prioridade]);
    return (["urgente", "alta", "media", "baixa"] as const)
      .map((v) => ({ value: v, count: c.get(v) ?? 0, label: PRIORIDADE_LABEL[v] }))
      .filter((o) => o.count > 0);
  }, [globalList, facets]);

  const tipoOptions: Option[] = useMemo(() => {
    const c = countBy(applyFacets(globalList, facets, "tipos"), (t) => [tipoOf(t)]);
    return [...c.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "pt-BR"));
  }, [globalList, facets]);

  const meetingDateCounts = useMemo(() => {
    const base = applyFacets(globalList, facets, "meetingDate");
    const bs: MeetingDateBucket[] = ["qualquer", "hoje", "semana", "mes", "antigas"];
    return Object.fromEntries(
      bs.map((b) => [b, b === "qualquer" ? base.length : base.filter((t) => inMeetingDate(t, b)).length]),
    ) as Record<MeetingDateBucket, number>;
  }, [globalList, facets]);

  const aberta = (t: Tarefa) =>
    t.status !== "concluida" && t.status !== "cancelada";
  const executar = filtered.filter((t) => aberta(t) && t.acao === "executar");
  const cobrar = filtered.filter((t) => aberta(t) && t.acao === "cobrar");
  const aguardando = filtered.filter((t) => aberta(t) && t.acao === "aguardar");
  const concluidas = filtered.filter((t) => !aberta(t));
  const abertas = filtered.filter(aberta);

  const urgentCount = useMemo(
    () => tarefas.filter(isUrgentish).length,
    [tarefas],
  );

  // ─── Filtros: toggles + chips + limpar ──────────────────────────────
  const toggleIn = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    v: string,
  ) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const filterByArea = (area: string) =>
    setSelAreas((prev) => new Set(prev).add(area));

  // Bucket e intervalo são mutuamente exclusivos por faceta de data.
  const onMeetingBucket = (b: MeetingDateBucket) => {
    setMeetingRange(EMPTY_RANGE);
    setMeetingDate(b);
  };
  const onMeetingRange = (from: string, to: string) => {
    setMeetingDate("qualquer");
    setMeetingRange({ from, to });
  };
  const onCreatedBucketSel = (b: CreatedBucket) => {
    setCreatedRange(EMPTY_RANGE);
    setCreatedBucket(b);
  };
  const onCreatedRange = (from: string, to: string) => {
    setCreatedBucket("todas");
    setCreatedRange({ from, to });
  };

  function clearAllFilters() {
    setSelPessoas(new Set());
    setSelAreas(new Set());
    setMeetingDate("qualquer");
    setMeetingRange(EMPTY_RANGE);
    setSelPrioridades(new Set());
    setSelTipos(new Set());
    setCreatedBucket("todas");
    setCreatedRange(EMPTY_RANGE);
    setGroupMode("prazo");
    setSortKey("prazo");
    setSearch("");
  }

  const panelActiveCount =
    activeFacetCount(facets) +
    (createdBucket !== "todas" || createdRange.from || createdRange.to ? 1 : 0);

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = [];
    for (const p of selPessoas)
      out.push({ id: `p-${p}`, label: `Pessoa: ${p}`, onRemove: () => toggleIn(setSelPessoas, p) });
    for (const a of selAreas)
      out.push({ id: `a-${a}`, label: `Área: ${a}`, onRemove: () => toggleIn(setSelAreas, a) });
    if (meetingDate !== "qualquer")
      out.push({ id: "md", label: `Reunião: ${MEETING_DATE_LABEL[meetingDate]}`, onRemove: () => setMeetingDate("qualquer") });
    if (meetingRange.from || meetingRange.to)
      out.push({ id: "mr", label: `Reunião: ${rangeLabel(meetingRange)}`, onRemove: () => setMeetingRange(EMPTY_RANGE) });
    if (createdRange.from || createdRange.to)
      out.push({ id: "cr", label: `Tarefa: ${rangeLabel(createdRange)}`, onRemove: () => setCreatedRange(EMPTY_RANGE) });
    for (const pr of selPrioridades)
      out.push({ id: `pr-${pr}`, label: `Prioridade: ${PRIORIDADE_LABEL[pr] ?? pr}`, onRemove: () => toggleIn(setSelPrioridades, pr) });
    for (const tp of selTipos)
      out.push({ id: `t-${tp}`, label: `Tipo: ${tp}`, onRemove: () => toggleIn(setSelTipos, tp) });
    if (createdBucket !== "todas")
      out.push({ id: "cb", label: `Criada: ${CREATED_LABEL[createdBucket]}`, onRemove: () => setCreatedBucket("todas") });
    if (groupMode !== "prazo")
      out.push({ id: "gm", label: `Agrupar: ${GROUPMODE_LABEL[groupMode]}`, onRemove: () => setGroupMode("prazo") });
    if (sortKey !== "prazo")
      out.push({ id: "sort", label: `Ordenar: ${SORT_LABEL[sortKey]}`, onRemove: () => setSortKey("prazo") });
    return out;
  }, [selPessoas, selAreas, meetingDate, meetingRange, selPrioridades, selTipos, createdBucket, createdRange, groupMode, sortKey]);

  // ─── Seleção em massa ───────────────────────────────────────────────
  const byId = useMemo(() => {
    const m = new Map<string, Tarefa>();
    for (const t of tarefas) m.set(t.id, t);
    return m;
  }, [tarefas]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedTarefas = useMemo(
    () => selectedIds.map((id) => byId.get(id)).filter((t): t is Tarefa => !!t),
    [selectedIds, byId],
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMany(ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const clearSelection = () => setSelected(new Set());

  const activeList = useMemo(() => {
    switch (activeTab) {
      case "executar":
        return executar;
      case "cobrar":
        return cobrar;
      case "aguardando":
        return aguardando;
      case "concluidas":
        return concluidas;
      default:
        return abertas;
    }
  }, [activeTab, executar, cobrar, aguardando, concluidas, abertas]);

  const selectAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of activeList) next.add(t.id);
      return next;
    });

  // ─── Render ─────────────────────────────────────────────────────────
  const rows = (items: Tarefa[]) =>
    sortTarefas(items, sortKey).map((t) => (
      <TaskRow
        key={t.id}
        tarefa={t}
        selected={selected.has(t.id)}
        onToggleSelect={toggleSelect}
        onFilterArea={filterByArea}
      />
    ));

  const groupedView = (groups: [string, Tarefa[]][], accent = "text-[color:var(--muted-strong)]") => (
    <div className="space-y-6">
      {groups.map(([label, items], gi) =>
        items.length === 0 ? null : (
          <div key={`${label}-${gi}`}>
            <GroupHeader
              label={label}
              count={items.length}
              accent={accent}
              ids={items.map((t) => t.id)}
              selected={selected}
              onToggleGroup={toggleMany}
            />
            <div className="flex flex-col gap-2">{rows(items)}</div>
          </div>
        ),
      )}
    </div>
  );

  const renderList = (list: Tarefa[], empty: string) => {
    if (!list.length) {
      return (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] py-12 px-6 text-center">
          <Sparkles size={20} strokeWidth={1.5} className="mx-auto mb-3 text-[color:var(--muted)]" />
          <p className="text-[14px] text-[color:var(--muted-strong)]">{empty}</p>
        </div>
      );
    }

    if (groupMode === "nenhum")
      return <div className="flex flex-col gap-2">{rows(list)}</div>;
    if (groupMode === "frente") return groupedView(groupByFrente(list));
    if (groupMode === "pessoa") return groupedView(groupByPessoa(list));
    if (groupMode === "reuniao") return groupedView(groupByReuniao(list));

    // groupMode === "prazo": agrupa por prazo só quando não há bucket de data ativo.
    if (bucket !== "todos") {
      return <div className="flex flex-col gap-2">{rows(list)}</div>;
    }
    const groups = groupByPrazo(list);
    return (
      <div className="space-y-6">
        {PRAZO_ORDER.map((key) => {
          const items = groups[key];
          if (!items.length) return null;
          return (
            <div key={key}>
              <GroupHeader
                label={GROUP_LABELS[key]}
                count={items.length}
                accent={GROUP_ACCENT[key]}
                ids={items.map((t) => t.id)}
                selected={selected}
                onToggleGroup={toggleMany}
              />
              <div className="flex flex-col gap-2">{rows(items)}</div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={cn("space-y-5", selected.size > 0 && "pb-44")}>
      <div className="sticky top-14 z-30 -mx-5 sm:-mx-6 px-5 sm:px-6 py-2.5 bg-[color:var(--background)]/95 backdrop-blur-md border-b border-[color:var(--border)] space-y-2">
        <CaptureComposer onOpenFull={() => setCreating(true)} />
        <DateFilter value={bucket} onChange={setBucket} counts={counts} />

        {/* Busca + foco rápido + Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--card)]">
            <Search size={13} className="text-[color:var(--muted)] shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tarefa, pessoa, área…"
              className="flex-1 min-w-0 bg-transparent text-[13px] outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
                className="shrink-0 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {urgentCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyUrgent((v) => !v)}
              title="Só urgentes / alta"
              className={cn(
                "press-feedback shrink-0 inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-full border transition cursor-pointer",
                onlyUrgent
                  ? "bg-[color:var(--urgent)] text-white border-[color:var(--urgent)]"
                  : "bg-transparent border-[color:var(--urgent)]/30 text-[color:var(--urgent)] hover:border-[color:var(--urgent)]",
              )}
            >
              <Flame size={12} strokeWidth={2.5} />
              <span className="hidden sm:inline">urgentes</span>
              <span className={cn("text-[10px]", onlyUrgent ? "opacity-80" : "opacity-60")}>
                {urgentCount}
              </span>
            </button>
          )}
          <FiltersPanel
            groupMode={groupMode}
            onGroupMode={setGroupMode}
            sortKey={sortKey}
            onSortKey={setSortKey}
            meetingDate={meetingDate}
            onMeetingDate={onMeetingBucket}
            meetingDateCounts={meetingDateCounts}
            meetingFrom={meetingRange.from}
            meetingTo={meetingRange.to}
            onMeetingRange={onMeetingRange}
            pessoaOptions={pessoaOptions}
            selPessoas={selPessoas}
            onTogglePessoa={(v) => toggleIn(setSelPessoas, v)}
            areaOptions={areaOptions}
            selAreas={selAreas}
            onToggleArea={(v) => toggleIn(setSelAreas, v)}
            prioridadeOptions={prioridadeOptions}
            selPrioridades={selPrioridades}
            onTogglePrioridade={(v) => toggleIn(setSelPrioridades, v)}
            tipoOptions={tipoOptions}
            selTipos={selTipos}
            onToggleTipo={(v) => toggleIn(setSelTipos, v)}
            createdBucket={createdBucket}
            onCreatedBucket={onCreatedBucketSel}
            createdCounts={createdCounts}
            createdFrom={createdRange.from}
            createdTo={createdRange.to}
            onCreatedRange={onCreatedRange}
            activeCount={panelActiveCount}
            onClearAll={clearAllFilters}
          />
        </div>

        <ActiveFilters chips={chips} onClearAll={clearAllFilters} />
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "todas",
            label: "Todas",
            count: abertas.length,
            content: renderList(
              abertas,
              tarefas.length === 0
                ? "Nada por aqui ainda. Grave um áudio ou capture uma tarefa."
                : "Nenhuma pendência nesse filtro.",
            ),
          },
          {
            key: "executar",
            label: "Eu faço",
            count: executar.length,
            content: renderList(executar, "Nada pra você fazer nesse filtro."),
          },
          {
            key: "cobrar",
            label: "Eu cobro",
            count: cobrar.length,
            content: renderList(cobrar, "Nada pra cobrar de ninguém nesse filtro."),
          },
          {
            key: "aguardando",
            label: "Aguardando",
            count: aguardando.length,
            content: renderList(aguardando, "Nada esperando entrega de outros nesse filtro."),
          },
          {
            key: "concluidas",
            label: "Concluídas",
            count: concluidas.length,
            content: renderList(concluidas, "Nenhuma tarefa concluída nesse filtro."),
          },
        ]}
      />

      {creating && <TaskCreateModal onClose={() => setCreating(false)} />}

      <BulkActionBar
        selectedIds={selectedIds}
        selectedTarefas={selectedTarefas}
        frentes={frentes}
        allVisibleCount={activeList.length}
        onSelectAll={selectAllVisible}
        onClear={clearSelection}
      />
    </div>
  );
}

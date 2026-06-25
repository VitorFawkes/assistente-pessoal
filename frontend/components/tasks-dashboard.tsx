"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Flame, Plus, Check } from "lucide-react";
import { TaskRow, type Tarefa } from "./task-row";
import { TaskCreateModal } from "./task-create-modal";
import { CaptureComposer } from "./capture-composer";
import { Tabs } from "./tabs";
import { ViewMenu } from "./view-menu";
import { BulkActionBar } from "./bulk-action-bar";
import { DateFilter, filterByDate, type DateBucket } from "./date-filter";
import {
  filterByCreated,
  type CreatedBucket,
} from "./created-filter";
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

function frenteOf(t: Tarefa): string {
  return t.frente || t.frente_proposta || "Sem área";
}

// Dentro de uma frente, mantém a ordem de prazo (vencidas → … → sem prazo).
function orderByPrazo(list: Tarefa[]): Tarefa[] {
  const g = groupByPrazo(list);
  return PRAZO_ORDER.flatMap((k) => g[k]);
}

// Agrupa por frente/área, ordena frentes A→Z ("Sem área" por último).
function groupByFrente(list: Tarefa[]): [string, Tarefa[]][] {
  const map = new Map<string, Tarefa[]>();
  for (const t of list) {
    const key = frenteOf(t);
    const arr = map.get(key);
    if (arr) arr.push(t);
    else map.set(key, [t]);
  }
  return [...map.entries()]
    .map(([k, items]) => [k, orderByPrazo(items)] as [string, Tarefa[]])
    .sort((a, b) => {
      if (a[0] === "Sem área") return 1;
      if (b[0] === "Sem área") return -1;
      return a[0].localeCompare(b[0], "pt-BR");
    });
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
        className={cn(
          "text-[11px] tracking-[0.2em] uppercase font-semibold",
          accent,
        )}
      >
        {label}
      </h3>
      <span className="text-[11px] text-[color:var(--muted)]">{count}</span>
    </div>
  );
}

export function TasksDashboard({ tarefas }: { tarefas: Tarefa[] }) {
  const [bucket, setBucket] = useState<DateBucket>("todos");
  const [createdBucket, setCreatedBucket] = useState<CreatedBucket>("todas");
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [groupMode, setGroupMode] = useState<"prazo" | "frente">("prazo");
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState("todas");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);

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
    const bs: DateBucket[] = [
      "todos",
      "vencidas",
      "hoje",
      "semana",
      "mes",
      "sem_prazo",
    ];
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

  const filteredByDate = useMemo(
    () => filterByDate(tarefas, bucket),
    [tarefas, bucket],
  );

  const filteredByCreated = useMemo(
    () => filterByCreated(filteredByDate, createdBucket),
    [filteredByDate, createdBucket],
  );

  const filtered = useMemo(
    () =>
      onlyUrgent
        ? filteredByCreated.filter(
            (t) => t.prioridade === "urgente" || t.prioridade === "alta",
          )
        : filteredByCreated,
    [filteredByCreated, onlyUrgent],
  );

  const aberta = (t: Tarefa) =>
    t.status !== "concluida" && t.status !== "cancelada";
  const executar = filtered.filter((t) => aberta(t) && t.acao === "executar");
  const cobrar = filtered.filter((t) => aberta(t) && t.acao === "cobrar");
  const aguardando = filtered.filter((t) => aberta(t) && t.acao === "aguardar");
  const concluidas = filtered.filter((t) => !aberta(t));
  const abertas = filtered.filter(aberta);

  const urgentCount = useMemo(
    () =>
      tarefas.filter(
        (t) => t.prioridade === "urgente" || t.prioridade === "alta",
      ).length,
    [tarefas],
  );

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

  // Marca todos de uma lista; se já estão todos marcados, desmarca-os.
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

  // Lista visível na aba ativa (base pro "selecionar tudo").
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

  // Renderiza lista — se filter de data = "todos", agrupa por prazo/área automaticamente
  const renderList = (list: Tarefa[], empty: string) => {
    if (!list.length) {
      return (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] py-12 px-6 text-center">
          <Sparkles
            size={20}
            strokeWidth={1.5}
            className="mx-auto mb-3 text-[color:var(--muted)]"
          />
          <p className="text-[14px] text-[color:var(--muted-strong)]">{empty}</p>
        </div>
      );
    }

    const rows = (items: Tarefa[]) =>
      items.map((t) => (
        <TaskRow
          key={t.id}
          tarefa={t}
          selected={selected.has(t.id)}
          onToggleSelect={toggleSelect}
        />
      ));

    if (bucket !== "todos") {
      // Filtro de data ativo — lista plana
      return <div className="flex flex-col gap-2">{rows(list)}</div>;
    }

    if (groupMode === "frente") {
      return (
        <div className="space-y-6">
          {groupByFrente(list).map(([frente, items]) => (
            <div key={frente}>
              <GroupHeader
                label={frente}
                count={items.length}
                accent="text-[color:var(--muted-strong)]"
                ids={items.map((t) => t.id)}
                selected={selected}
                onToggleGroup={toggleMany}
              />
              <div className="flex flex-col gap-2">{rows(items)}</div>
            </div>
          ))}
        </div>
      );
    }

    // Sem filtro de data — agrupa por prazo
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
      <div className="sticky top-14 z-30 -mx-5 sm:-mx-6 px-5 sm:px-6 py-3 bg-[color:var(--background)]/95 backdrop-blur-md border-b border-[color:var(--border)] space-y-3">
        <CaptureComposer onOpenFull={() => setCreating(true)} />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="press-feedback inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] hover:opacity-90 transition cursor-pointer"
          >
            <Plus size={15} strokeWidth={2.5} />
            Nova tarefa
          </button>
        </div>
        <DateFilter value={bucket} onChange={setBucket} counts={counts} />
        {/* Linha enxuta: foco rápido (urgentes) + menu "Ver" com o resto */}
        <div className="flex items-center justify-between gap-2">
          {urgentCount > 0 ? (
            <button
              type="button"
              onClick={() => setOnlyUrgent((v) => !v)}
              className={cn(
                "press-feedback inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full border transition cursor-pointer",
                onlyUrgent
                  ? "bg-[color:var(--urgent)] text-white border-[color:var(--urgent)]"
                  : "bg-transparent border-[color:var(--urgent)]/30 text-[color:var(--urgent)] hover:border-[color:var(--urgent)]",
              )}
            >
              <Flame size={11} strokeWidth={2.5} />
              só urgentes / alta
              <span className={cn("text-[10px]", onlyUrgent ? "opacity-80" : "opacity-60")}>
                {urgentCount}
              </span>
            </button>
          ) : (
            <span />
          )}
          <ViewMenu
            groupMode={groupMode}
            onGroupMode={setGroupMode}
            showGroup={bucket === "todos"}
            createdBucket={createdBucket}
            onCreatedBucket={setCreatedBucket}
            createdCounts={createdCounts}
          />
        </div>
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
                ? "Nada por aqui ainda. Grave um áudio ou toque em “Nova tarefa”."
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
            content: renderList(
              aguardando,
              "Nada esperando entrega de outros nesse filtro.",
            ),
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

"use client";

import { useMemo, useState } from "react";
import { Sparkles, Flame } from "lucide-react";
import { TaskRow, type Tarefa } from "./task-row";
import { Tabs } from "./tabs";
import { DateFilter, filterByDate, type DateBucket } from "./date-filter";
import {
  CreatedFilter,
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

function GroupHeader({ label, count, accent }: {
  label: string;
  count: number;
  accent: string;
}) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
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

  // Renderiza lista — se filter de data = "todos", agrupa por prazo automaticamente
  const renderList = (list: Tarefa[], empty: string) => {
    if (!list.length) {
      return (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] py-12 px-6 text-center">
          <Sparkles
            size={20}
            strokeWidth={1.5}
            className="mx-auto mb-3 text-[color:var(--muted)]"
          />
          <p className="text-[14px] text-[color:var(--muted-strong)]">
            {empty}
          </p>
        </div>
      );
    }

    if (bucket !== "todos") {
      // Filtro de data ativo — lista plana
      return (
        <div className="flex flex-col gap-2">
          {list.map((t) => (
            <TaskRow key={t.id} tarefa={t} />
          ))}
        </div>
      );
    }

    // Sem filtro de data — agrupa por prazo
    const groups = groupByPrazo(list);
    const order: GroupKey[] = [
      "vencidas",
      "hoje",
      "esta_semana",
      "futuro",
      "sem_prazo",
    ];

    return (
      <div className="space-y-6">
        {order.map((key) => {
          const items = groups[key];
          if (!items.length) return null;
          return (
            <div key={key}>
              <GroupHeader
                label={GROUP_LABELS[key]}
                count={items.length}
                accent={GROUP_ACCENT[key]}
              />
              <div className="flex flex-col gap-2">
                {items.map((t) => (
                  <TaskRow key={t.id} tarefa={t} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="sticky top-14 z-30 -mx-5 sm:-mx-6 px-5 sm:px-6 py-3 bg-[color:var(--background)]/95 backdrop-blur-md border-b border-[color:var(--border)] space-y-3">
        <DateFilter value={bucket} onChange={setBucket} counts={counts} />
        <CreatedFilter
          value={createdBucket}
          onChange={setCreatedBucket}
          counts={createdCounts}
        />
        {urgentCount > 0 && (
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
            <span
              className={cn(
                "text-[10px]",
                onlyUrgent ? "opacity-80" : "opacity-60",
              )}
            >
              {urgentCount}
            </span>
          </button>
        )}
      </div>
      <Tabs
        defaultKey="todas"
        items={[
          {
            key: "todas",
            label: "Todas",
            count: abertas.length,
            content: renderList(
              abertas,
              tarefas.length === 0
                ? "Nada por aqui ainda. Grave um áudio e em ~30s aparece."
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
            content: renderList(
              cobrar,
              "Nada pra cobrar de ninguém nesse filtro.",
            ),
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
            content: renderList(
              concluidas,
              "Nenhuma tarefa concluída nesse filtro.",
            ),
          },
        ]}
      />
    </div>
  );
}

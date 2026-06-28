"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal, Check, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreatedBucket } from "./created-filter";
import type { MeetingDateBucket } from "@/lib/task-filters";

export type GroupMode = "prazo" | "frente" | "pessoa" | "reuniao";
export type Option = { value: string; count: number; label?: string };

const MEETING_DATE: { k: MeetingDateBucket; label: string }[] = [
  { k: "qualquer", label: "Qualquer data" },
  { k: "hoje", label: "Hoje" },
  { k: "semana", label: "Esta semana" },
  { k: "mes", label: "Este mês" },
  { k: "antigas", label: "Mais antigas" },
];

const CREATED: { k: CreatedBucket; label: string }[] = [
  { k: "todas", label: "Qualquer data" },
  { k: "hoje", label: "Criadas hoje" },
  { k: "semana", label: "Esta semana" },
  { k: "mes", label: "Este mês" },
];

const GROUPS: { k: GroupMode; label: string }[] = [
  { k: "prazo", label: "Prazo" },
  { k: "frente", label: "Área" },
  { k: "pessoa", label: "Pessoa" },
  { k: "reuniao", label: "Reunião" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] mb-1.5">
      {children}
    </p>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[12px] px-2.5 py-1 rounded-full border transition",
        active
          ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)] font-medium"
          : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
      )}
    >
      {children}
    </button>
  );
}

// Linha de faceta multi-seleção: checkbox + label + contagem.
function CheckRow({
  label,
  count,
  checked,
  onToggle,
}: {
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      className={cn(
        "w-full flex items-center gap-2 text-[13px] px-2 py-1.5 rounded-lg transition text-left",
        checked
          ? "bg-[color:var(--accent)] text-[color:var(--foreground)]"
          : "text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]/60",
      )}
    >
      <span
        className={cn(
          "w-4 h-4 shrink-0 rounded border flex items-center justify-center",
          checked
            ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
            : "border-[color:var(--muted)]/60 text-transparent",
        )}
      >
        <Check size={11} strokeWidth={3} />
      </span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="text-[11px] text-[color:var(--muted)] tabular-nums">{count}</span>
    </button>
  );
}

function MultiFacet({
  options,
  selected,
  onToggle,
  searchable,
}: {
  options: Option[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter(
      (o) =>
        o.value.toLowerCase().includes(s) ||
        (o.label ?? "").toLowerCase().includes(s),
    );
  }, [options, q]);

  if (options.length === 0) {
    return <p className="text-[12px] text-[color:var(--muted)] px-2">nada aqui ainda</p>;
  }

  return (
    <div className="space-y-1">
      {searchable && options.length > 6 && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[color:var(--border)] mb-1">
          <Search size={12} className="text-[color:var(--muted-strong)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="buscar…"
            className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-[color:var(--muted-strong)]"
          />
        </div>
      )}
      <div className="max-h-44 overflow-y-auto -mr-1 pr-1 space-y-0.5">
        {shown.map((o) => (
          <CheckRow
            key={o.value}
            label={o.label ?? o.value}
            count={o.count}
            checked={selected.has(o.value)}
            onToggle={() => onToggle(o.value)}
          />
        ))}
      </div>
    </div>
  );
}

// Intervalo de datas (de/até). Tem precedência sobre os atalhos rápidos.
function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const inputCls =
    "flex-1 min-w-0 px-1.5 py-0.5 rounded border border-[color:var(--border)] bg-transparent text-[12px] outline-none focus:border-[color:var(--muted)]";
  return (
    <div className="flex items-center gap-1 mt-1.5">
      <input
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onChange(e.target.value, to)}
        aria-label="De"
        className={inputCls}
      />
      <span className="text-[11px] text-[color:var(--muted)] shrink-0">até</span>
      <input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onChange(from, e.target.value)}
        aria-label="Até"
        className={inputCls}
      />
      {(from || to) && (
        <button
          type="button"
          onClick={() => onChange("", "")}
          aria-label="Limpar intervalo"
          className="shrink-0 p-0.5 text-[color:var(--muted)] hover:text-[color:var(--urgent)]"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function FiltersPanel({
  groupMode,
  onGroupMode,
  meetingDate,
  onMeetingDate,
  meetingDateCounts,
  meetingFrom,
  meetingTo,
  onMeetingRange,
  pessoaOptions,
  selPessoas,
  onTogglePessoa,
  areaOptions,
  selAreas,
  onToggleArea,
  prioridadeOptions,
  selPrioridades,
  onTogglePrioridade,
  tipoOptions,
  selTipos,
  onToggleTipo,
  createdBucket,
  onCreatedBucket,
  createdCounts,
  createdFrom,
  createdTo,
  onCreatedRange,
  activeCount,
  onClearAll,
}: {
  groupMode: GroupMode;
  onGroupMode: (m: GroupMode) => void;
  meetingDate: MeetingDateBucket;
  onMeetingDate: (b: MeetingDateBucket) => void;
  meetingDateCounts: Record<MeetingDateBucket, number>;
  meetingFrom: string;
  meetingTo: string;
  onMeetingRange: (from: string, to: string) => void;
  pessoaOptions: Option[];
  selPessoas: Set<string>;
  onTogglePessoa: (v: string) => void;
  areaOptions: Option[];
  selAreas: Set<string>;
  onToggleArea: (v: string) => void;
  prioridadeOptions: Option[];
  selPrioridades: Set<string>;
  onTogglePrioridade: (v: string) => void;
  tipoOptions: Option[];
  selTipos: Set<string>;
  onToggleTipo: (v: string) => void;
  createdBucket: CreatedBucket;
  onCreatedBucket: (b: CreatedBucket) => void;
  createdCounts: Record<CreatedBucket, number>;
  createdFrom: string;
  createdTo: string;
  onCreatedRange: (from: string, to: string) => void;
  activeCount: number;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<number>();

  // Altura máxima dinâmica: cabe da posição do painel até o fim da viewport
  // (o painel abre lá embaixo na barra fixa, então 70vh estourava a tela).
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = panelRef.current;
      if (!el) return;
      setMaxH(Math.max(220, window.innerHeight - el.getBoundingClientRect().top - 12));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasActive =
    activeCount > 0 ||
    groupMode !== "prazo" ||
    createdBucket !== "todas" ||
    !!createdFrom ||
    !!createdTo;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "press-feedback inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full border transition cursor-pointer",
          activeCount > 0 || open
            ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)]"
            : "bg-[color:var(--card)] border-[color:var(--border)] text-[color:var(--muted-strong)] hover:border-[color:var(--muted)]",
        )}
      >
        <SlidersHorizontal size={13} />
        Filtros
        {activeCount > 0 && (
          <span
            className={cn(
              "text-[10px] min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full",
              open
                ? "bg-[color:var(--background)] text-[color:var(--foreground)]"
                : "bg-[color:var(--background)]/25",
            )}
          >
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{ maxHeight: maxH }}
          className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] z-40 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-xl p-3 overflow-y-auto space-y-3"
        >
          <div className="flex items-center justify-between">
            <SectionLabel>Agrupar por</SectionLabel>
            {hasActive && (
              <button
                type="button"
                onClick={onClearAll}
                className="text-[11px] text-[color:var(--muted)] hover:text-[color:var(--urgent)] inline-flex items-center gap-0.5"
              >
                <X size={11} /> limpar
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map((g) => (
              <Pill key={g.k} active={groupMode === g.k} onClick={() => onGroupMode(g.k)}>
                {g.label}
              </Pill>
            ))}
          </div>

          <div>
            <SectionLabel>Pessoa</SectionLabel>
            <MultiFacet
              options={pessoaOptions}
              selected={selPessoas}
              onToggle={onTogglePessoa}
              searchable
            />
          </div>

          <div>
            <SectionLabel>Área</SectionLabel>
            <MultiFacet options={areaOptions} selected={selAreas} onToggle={onToggleArea} />
          </div>

          <div>
            <SectionLabel>Data da reunião</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {MEETING_DATE.map((m) => (
                <Pill
                  key={m.k}
                  active={meetingDate === m.k && !meetingFrom && !meetingTo}
                  onClick={() => onMeetingDate(m.k)}
                >
                  {m.label}
                  {m.k !== "qualquer" && meetingDateCounts[m.k] > 0 && (
                    <span className="ml-1 opacity-60">{meetingDateCounts[m.k]}</span>
                  )}
                </Pill>
              ))}
            </div>
            <DateRange from={meetingFrom} to={meetingTo} onChange={onMeetingRange} />
          </div>

          <div>
            <SectionLabel>Prioridade</SectionLabel>
            <MultiFacet
              options={prioridadeOptions}
              selected={selPrioridades}
              onToggle={onTogglePrioridade}
            />
          </div>

          {tipoOptions.length > 0 && (
            <div>
              <SectionLabel>Tipo de reunião</SectionLabel>
              <MultiFacet options={tipoOptions} selected={selTipos} onToggle={onToggleTipo} />
            </div>
          )}

          <div>
            <SectionLabel>Data da tarefa (criação)</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {CREATED.map((c) => (
                <Pill
                  key={c.k}
                  active={createdBucket === c.k && !createdFrom && !createdTo}
                  onClick={() => onCreatedBucket(c.k)}
                >
                  {c.label}
                  {c.k !== "todas" && createdCounts[c.k] > 0 && (
                    <span className="ml-1 opacity-60">{createdCounts[c.k]}</span>
                  )}
                </Pill>
              ))}
            </div>
            <DateRange from={createdFrom} to={createdTo} onChange={onCreatedRange} />
          </div>
        </div>
      )}
    </div>
  );
}

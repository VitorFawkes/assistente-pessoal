"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, X, Check, CalendarClock, Mic, UserRound } from "lucide-react";
import { cn, formatPrazo } from "@/lib/utils";
import type { Tarefa } from "@/lib/queries";
import { FacetDropdown, type Opt } from "./facet-dropdown";
import { ActiveFilters, type ActiveChip } from "./active-filters";
import { DateField } from "./date-field";
import { meetingDateShort, meetingSubject } from "@/lib/meeting-label";
import {
  applyFacets,
  matchesSearch,
  countBy,
  sortTarefas,
  peopleForFilter,
  areaOf,
  reuniaoOf,
  tipoOf,
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
const TIPO_LABEL: Record<string, string> = {
  Manual: "Escrita à mão",
  online: "Reunião online",
  presencial: "Presencial",
  desconhecido: "Origem não identificada",
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

export function TaskPickerModal({ quadroId, onClose, onAdded }: Props) {
  const [candidatas, setCandidatas] = useState<Tarefa[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const [search, setSearch] = useState("");
  const [selPessoas, setSelPessoas] = useState<Set<string>>(new Set());
  const [selAreas, setSelAreas] = useState<Set<string>>(new Set());
  const [selPrioridades, setSelPrioridades] = useState<Set<string>>(new Set());
  const [selReunioes, setSelReunioes] = useState<Set<string>>(new Set());
  const [meetingDate, setMeetingDate] = useState<MeetingDateBucket>("qualquer");
  const [meetingFrom, setMeetingFrom] = useState("");
  const [meetingTo, setMeetingTo] = useState("");
  const [selTipos, setSelTipos] = useState<Set<string>>(new Set());
  const [prazoFrom, setPrazoFrom] = useState("");
  const [prazoTo, setPrazoTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("criacao_desc");
  const [reuniaoOrder, setReuniaoOrder] = useState<"data" | "quantidade">("data");
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    fetch(`/api/quadros/${quadroId}/tarefas`)
      .then((r) => r.json())
      .then((d: { candidatas?: Tarefa[]; truncado?: boolean }) => {
        setCandidatas(d.candidatas ?? []);
        setTruncado(Boolean(d.truncado));
      })
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
    const c = countBy(base, peopleForFilter);
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
    const m = new Map<string, { label: string; count: number; at: number }>();
    for (const t of base) {
      const k = meetingKey(t);
      const g = m.get(k);
      if (g) g.count++;
      else
        m.set(k, {
          label: reuniaoOf(t),
          count: 1,
          at: t.meeting_recorded_at ? new Date(t.meeting_recorded_at).getTime() : 0,
        });
    }
    return [...m.entries()]
      .map(([value, { label, count, at }]) => ({ value, label, count, at }))
      .sort((a, b) => {
        if (a.value === "sem") return 1;
        if (b.value === "sem") return -1;
        // Por data é o padrão: "a última reunião" é como se procura uma reunião.
        return reuniaoOrder === "data" ? b.at - a.at : b.count - a.count;
      })
      .map(({ value, label, count }) => ({ value, label, count }));
  }, [base, reuniaoOrder]);

  const tipoOpts: Opt[] = useMemo(() => {
    const c = countBy(base, (t) => [tipoOf(t)]);
    const opts = [...c.entries()]
      .map(([value, count]) => ({ value, label: TIPO_LABEL[value] ?? value, count }))
      .sort((a, b) => b.count - a.count);
    return opts.length > 1 ? opts : [];
  }, [base]);

  const filtered = useMemo(() => {
    const facets: Facets = {
      pessoas: selPessoas,
      areas: selAreas,
      meetingDate,
      meetingFrom,
      meetingTo,
      prioridades: selPrioridades,
      tipos: selTipos,
    };
    let l = applyFacets(base, facets);
    if (selReunioes.size) l = l.filter((t) => selReunioes.has(meetingKey(t)));
    if (prazoFrom || prazoTo) l = l.filter((t) => dateInRange(t.prazo, prazoFrom, prazoTo));
    return sortTarefas(l, sortKey);
  }, [
    base, selPessoas, selAreas, meetingDate, meetingFrom, meetingTo,
    selPrioridades, selTipos, selReunioes, prazoFrom, prazoTo, sortKey,
  ]);

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

  const clearFilters = () => {
    setSelPessoas(new Set());
    setSelAreas(new Set());
    setSelPrioridades(new Set());
    setSelReunioes(new Set());
    setMeetingDate("qualquer");
    setMeetingFrom("");
    setMeetingTo("");
    setSelTipos(new Set());
    setPrazoFrom("");
    setPrazoTo("");
    setSearch("");
  };

  // "2026-08-04" é o formato interno; o chip fala com gente.
  const diaBR = (key: string) => {
    const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}` : key;
  };

  // Faixa do que está filtrado agora — mesmo padrão das Pendências. Sem ela,
  // o botão "Reunião" com 1 escolha não dizia QUAL reunião estava puxando.
  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = [];
    const removeFrom = (
      setter: React.Dispatch<React.SetStateAction<Set<string>>>,
      v: string,
    ) =>
      setter((prev) => {
        const next = new Set(prev);
        next.delete(v);
        return next;
      });
    for (const v of selReunioes)
      out.push({
        id: `r:${v}`,
        label: reuniaoOpts.find((o) => o.value === v)?.label ?? "reunião",
        onRemove: () => removeFrom(setSelReunioes, v),
      });
    for (const v of selPessoas)
      out.push({ id: `p:${v}`, label: v, onRemove: () => removeFrom(setSelPessoas, v) });
    for (const v of selAreas)
      out.push({ id: `a:${v}`, label: v, onRemove: () => removeFrom(setSelAreas, v) });
    for (const v of selPrioridades)
      out.push({
        id: `pr:${v}`,
        label: PRIO_LABEL[v] ?? v,
        onRemove: () => removeFrom(setSelPrioridades, v),
      });
    for (const v of selTipos)
      out.push({
        id: `t:${v}`,
        label: TIPO_LABEL[v] ?? v,
        onRemove: () => removeFrom(setSelTipos, v),
      });
    if (meetingFrom || meetingTo)
      out.push({
        id: "mr",
        label: `Reunião ${meetingFrom ? diaBR(meetingFrom) : "…"} → ${meetingTo ? diaBR(meetingTo) : "…"}`,
        onRemove: () => {
          setMeetingFrom("");
          setMeetingTo("");
        },
      });
    if (meetingDate !== "qualquer")
      out.push({
        id: "md",
        label: `Reunião: ${MEETING_BUCKETS.find((b) => b.k === meetingDate)?.label ?? meetingDate}`,
        onRemove: () => setMeetingDate("qualquer"),
      });
    if (prazoFrom || prazoTo)
      out.push({
        id: "prazo",
        label: `Prazo ${prazoFrom ? diaBR(prazoFrom) : "…"} → ${prazoTo ? diaBR(prazoTo) : "…"}`,
        onRemove: () => {
          setPrazoFrom("");
          setPrazoTo("");
        },
      });
    return out;
  }, [
    selReunioes, selPessoas, selAreas, selPrioridades, selTipos,
    meetingDate, meetingFrom, meetingTo, prazoFrom, prazoTo, reuniaoOpts,
  ]);

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
      <div className="w-full sm:max-w-3xl bg-[color:var(--card)] border border-[color:var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh]">
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
            <FacetDropdown
              label="Pessoa"
              options={pessoaOpts}
              selected={selPessoas}
              onToggle={(v) => toggleIn(setSelPessoas, v)}
              onClear={() => setSelPessoas(new Set())}
              searchable
            />
            <FacetDropdown
              label="Reunião"
              options={reuniaoOpts}
              selected={selReunioes}
              onToggle={(v) => toggleIn(setSelReunioes, v)}
              onClear={() => setSelReunioes(new Set())}
              searchable
              wide
              order={{
                options: [
                  { k: "data" as const, label: "data" },
                  { k: "quantidade" as const, label: "nº de tarefas" },
                ],
                value: reuniaoOrder,
                onChange: setReuniaoOrder,
              }}
            />
            <FacetDropdown
              label="Área"
              options={areaOpts}
              selected={selAreas}
              onToggle={(v) => toggleIn(setSelAreas, v)}
              onClear={() => setSelAreas(new Set())}
              searchable
            />
            <FacetDropdown
              label="Prioridade"
              options={prioOpts}
              selected={selPrioridades}
              onToggle={(v) => toggleIn(setSelPrioridades, v)}
              onClear={() => setSelPrioridades(new Set())}
            />
            {tipoOpts.length > 0 && (
              <FacetDropdown
                label="Tipo"
                options={tipoOpts}
                selected={selTipos}
                onToggle={(v) => toggleIn(setSelTipos, v)}
                onClear={() => setSelTipos(new Set())}
              />
            )}
            <select
              value={meetingDate}
              onChange={(e) => {
                setMeetingDate(e.target.value as MeetingDateBucket);
                setMeetingFrom("");
                setMeetingTo("");
              }}
              title="Data da reunião"
              className="text-[12px] px-2.5 py-1.5 rounded-full border border-[color:var(--border)] bg-transparent text-[color:var(--muted-strong)]"
            >
              {MEETING_BUCKETS.map((b) => (
                <option key={b.k} value={b.k}>Quando: {b.label}</option>
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
            {/* Intervalo exato da reunião — o painel de Pendências tem, e sem
                ele "esta semana" era o recorte mais fino possível. */}
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted)]">
              Reunião de
              <DateField
                value={meetingFrom}
                onChange={(v) => {
                  setMeetingFrom(v);
                  setMeetingDate("qualquer");
                }}
                placeholder="de"
                ariaLabel="Reunião a partir de"
              />
              até
              <DateField
                value={meetingTo}
                onChange={(v) => {
                  setMeetingTo(v);
                  setMeetingDate("qualquer");
                }}
                placeholder="até"
                ariaLabel="Reunião até"
              />
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted)]">
              Prazo
              <DateField
                value={prazoFrom}
                onChange={setPrazoFrom}
                placeholder="de"
                ariaLabel="Prazo a partir de"
              />
              até
              <DateField
                value={prazoTo}
                onChange={setPrazoTo}
                placeholder="até"
                ariaLabel="Prazo até"
              />
            </span>
          </div>

          {chips.length > 0 && <ActiveFilters chips={chips} onClearAll={clearFilters} />}
        </div>

        {/* Lista */}
        <div className="flex items-center justify-between px-5 pt-3 pb-1.5">
          <button type="button" onClick={toggleAllVisible} disabled={filtered.length === 0} className="text-[12px] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] disabled:opacity-40">
            {allVisibleOn ? "Desmarcar visíveis" : "Selecionar visíveis"} ({filtered.length})
          </button>
          {sel.size > 0 && <span className="text-[12px] text-[color:var(--muted)]">{sel.size} selecionada{sel.size > 1 ? "s" : ""}</span>}
        </div>
        {truncado && (
          <div className="px-5 pb-1.5">
            <p className="text-[11px] text-[color:var(--muted)]">
              Lista limitada às tarefas mais recentes — se não achar a que quer,
              use a busca acima.
            </p>
          </div>
        )}
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
                        <span
                          title={t.meeting_summary ?? undefined}
                          className="inline-flex items-center gap-1 max-w-[340px] truncate"
                        >
                          <Mic size={10} className="shrink-0" />
                          {meetingDateShort(t.meeting_recorded_at) && (
                            <span className="shrink-0 tabular-nums">
                              {meetingDateShort(t.meeting_recorded_at)}
                            </span>
                          )}
                          <span className="truncate">
                            {meetingSubject(t.meeting_summary) || "reunião"}
                          </span>
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

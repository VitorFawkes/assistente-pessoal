// Lógica pura de filtros/organização das pendências. Sem I/O — testável isolada.
// Tudo client-side (os dados já chegam em cada tarefa).

import type { Tarefa } from "@/components/task-row";
import { nowSP, toSP } from "@/lib/utils";

export type MeetingDateBucket = "qualquer" | "hoje" | "semana" | "mes" | "antigas";

export type Facets = {
  pessoas: Set<string>;
  areas: Set<string>;
  meetingDate: MeetingDateBucket;
  prioridades: Set<string>;
  tipos: Set<string>;
};

export type FacetKey = "pessoas" | "areas" | "meetingDate" | "prioridades" | "tipos";

export const SEM_AREA = "Sem área";

// Pessoas envolvidas na tarefa (eixo mais rico dos dados).
export function personNamesOf(t: Tarefa): string[] {
  return (t.pessoas ?? []).map((p) => p.nome).filter(Boolean);
}

// Área da tarefa (frente aprovada > proposta da IA > "Sem área").
export function areaOf(t: Tarefa): string {
  return t.frente || t.frente_proposta || SEM_AREA;
}

// "Tipo": manual (sem reunião) ou a modalidade da reunião (online/presencial/desconhecido).
export function tipoOf(t: Tarefa): string {
  if (!t.meeting_id) return "Manual";
  return t.meeting_type || "desconhecido";
}

// Pessoa pela qual agrupar: "Você" pra executar, senão a principal / owner.
export function principalPersonOf(t: Tarefa): string {
  if (t.acao === "executar") return "Você";
  const principal = (t.pessoas ?? []).find((p) => p.principal);
  if (principal) return principal.nome;
  const owner = (t.owner ?? "").trim();
  if (!owner || owner === "?") return "A definir";
  if (owner.toLowerCase() === "vitor") return "Você";
  return owner;
}

export function reuniaoOf(t: Tarefa): string {
  return t.meeting_summary || (t.meeting_id ? "Reunião" : "Sem reunião");
}

// Busca livre (AND entre os tokens) sobre os campos textuais relevantes.
export function matchesSearch(t: Tarefa, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [
    t.titulo,
    t.descricao,
    t.owner,
    t.frente,
    t.frente_proposta,
    t.meeting_summary,
    ...personNamesOf(t),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return s.split(/\s+/).every((tok) => hay.includes(tok));
}

// A reunião (recorded_at) cai no bucket pedido? Buckets são cumulativos
// (semana inclui hoje; mês inclui a semana; antigas = antes deste mês).
export function inMeetingDate(
  t: Tarefa,
  bucket: MeetingDateBucket,
  now: Date = nowSP(),
): boolean {
  if (bucket === "qualquer") return true;
  const iso = t.meeting_recorded_at;
  if (!iso) return false;
  const d = toSP(iso);
  if (Number.isNaN(d.getTime())) return false;
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startWeek = new Date(startToday);
  startWeek.setDate(startWeek.getDate() - startWeek.getDay());
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  switch (bucket) {
    case "hoje":
      return d >= startToday;
    case "semana":
      return d >= startWeek;
    case "mes":
      return d >= startMonth;
    case "antigas":
      return d < startMonth;
  }
}

// Aplica as facetas (AND entre facetas, OR dentro de cada uma). `exclude`
// pula uma faceta — usado pra calcular contagem "ao vivo" daquela faceta.
export function applyFacets(
  list: Tarefa[],
  f: Facets,
  exclude?: FacetKey,
  now: Date = nowSP(),
): Tarefa[] {
  return list.filter((t) => {
    if (
      exclude !== "pessoas" &&
      f.pessoas.size &&
      !personNamesOf(t).some((n) => f.pessoas.has(n))
    )
      return false;
    if (exclude !== "areas" && f.areas.size && !f.areas.has(areaOf(t)))
      return false;
    if (
      exclude !== "meetingDate" &&
      f.meetingDate !== "qualquer" &&
      !inMeetingDate(t, f.meetingDate, now)
    )
      return false;
    if (
      exclude !== "prioridades" &&
      f.prioridades.size &&
      !f.prioridades.has(t.prioridade)
    )
      return false;
    if (exclude !== "tipos" && f.tipos.size && !f.tipos.has(tipoOf(t)))
      return false;
    return true;
  });
}

// Conta ocorrências por chave (keyFn pode devolver 1+ chaves por tarefa).
export function countBy(
  list: Tarefa[],
  keyFn: (t: Tarefa) => string[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of list) {
    for (const k of keyFn(t)) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// Quantas facetas/seleções estão ativas (pro badge do botão Filtros).
export function activeFacetCount(f: Facets): number {
  return (
    f.pessoas.size +
    f.areas.size +
    f.prioridades.size +
    f.tipos.size +
    (f.meetingDate !== "qualquer" ? 1 : 0)
  );
}

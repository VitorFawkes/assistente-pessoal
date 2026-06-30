// Lógica pura de filtros/organização das pendências. Sem I/O — testável isolada.
// Tudo client-side (os dados já chegam em cada tarefa).

import type { Tarefa } from "@/components/task-row";
import { nowSP, toSP } from "@/lib/utils";

export type MeetingDateBucket = "qualquer" | "hoje" | "semana" | "mes" | "antigas";

export type SortKey =
  | "prazo"
  | "criacao_desc"
  | "criacao_asc"
  | "reuniao_desc"
  | "prioridade";

const PRIO_RANK: Record<string, number> = {
  urgente: 0,
  alta: 1,
  media: 2,
  baixa: 3,
};

// Timestamp robusto: aceita Date (vem do pg via RSC) OU string ISO. Vazio → fallback.
function toMs(v: string | Date | null | undefined, fallback: number): number {
  if (!v) return fallback;
  const ms = new Date(v).getTime();
  return Number.isNaN(ms) ? fallback : ms;
}

// Timestamp do prazo (sem prazo → Infinity, vai pro fim). Ordena por deadline asc.
export function prazoMs(t: Tarefa): number {
  return toMs(t.prazo, Infinity);
}

// Ordena a lista conforme a chave escolhida (não muta o original).
export function sortTarefas(list: Tarefa[], key: SortKey): Tarefa[] {
  const arr = [...list];
  switch (key) {
    case "criacao_desc":
      return arr.sort((a, b) => toMs(b.created_at, 0) - toMs(a.created_at, 0));
    case "criacao_asc":
      return arr.sort((a, b) => toMs(a.created_at, 0) - toMs(b.created_at, 0));
    case "reuniao_desc":
      // sem reunião (fallback 0) vai pro fim na ordem decrescente
      return arr.sort((a, b) => toMs(b.meeting_recorded_at, 0) - toMs(a.meeting_recorded_at, 0));
    case "prioridade":
      return arr.sort(
        (a, b) =>
          (PRIO_RANK[a.prioridade] ?? 9) - (PRIO_RANK[b.prioridade] ?? 9) ||
          prazoMs(a) - prazoMs(b),
      );
    default: // prazo: vencidas/mais cedo primeiro, sem prazo por último
      return arr.sort((a, b) => prazoMs(a) - prazoMs(b));
  }
}

export type Facets = {
  pessoas: Set<string>;
  areas: Set<string>;
  meetingDate: MeetingDateBucket;
  // Intervalo de datas da reunião (YYYY-MM-DD); tem precedência sobre o bucket.
  meetingFrom?: string;
  meetingTo?: string;
  prioridades: Set<string>;
  tipos: Set<string>;
};

export type FacetKey = "pessoas" | "areas" | "meetingDate" | "prioridades" | "tipos";

export const SEM_AREA = "Sem área";

// Pessoas envolvidas na tarefa (eixo mais rico dos dados).
export function personNamesOf(t: Tarefa): string[] {
  return (t.pessoas ?? []).map((p) => p.nome).filter(Boolean);
}

// Pessoa pela qual FILTRAR = o RESPONSÁVEL da tarefa (mesma lógica do chip e do
// "agrupar por pessoa": "Você" pra executar, senão a principal / owner).
// Filtrar por alguém traz só as tarefas DELA — não as que só a mencionam como
// participante secundário. (Pega também owner sem vínculo formal, via fallback.)
export function peopleForFilter(t: Tarefa): string[] {
  return [principalPersonOf(t)];
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

// Pessoa pela qual agrupar: "Vitor" pra executar, senão a principal / owner.
export function principalPersonOf(t: Tarefa): string {
  if (t.acao === "executar") return "Vitor";
  const principal = (t.pessoas ?? []).find((p) => p.principal);
  if (principal) return principal.nome;
  const owner = (t.owner ?? "").trim();
  if (!owner || owner === "?") return "A definir";
  if (owner.toLowerCase() === "vitor") return "Vitor";
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

// A data (ISO) cai no intervalo [from, to] (YYYY-MM-DD, comparação lexicográfica)?
export function dateInRange(
  iso: string | null | undefined,
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  const d = toSP(iso);
  if (Number.isNaN(d.getTime())) return false;
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
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
      !peopleForFilter(t).some((n) => f.pessoas.has(n))
    )
      return false;
    if (exclude !== "areas" && f.areas.size && !f.areas.has(areaOf(t)))
      return false;
    if (exclude !== "meetingDate") {
      if (f.meetingFrom || f.meetingTo) {
        if (!dateInRange(t.meeting_recorded_at, f.meetingFrom, f.meetingTo))
          return false;
      } else if (f.meetingDate !== "qualquer" && !inMeetingDate(t, f.meetingDate, now)) {
        return false;
      }
    }
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
    (f.meetingDate !== "qualquer" || f.meetingFrom || f.meetingTo ? 1 : 0)
  );
}

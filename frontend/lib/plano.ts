// Helpers puros (sem React) pra montar a linha do tempo do /plano.
// Toda a geometria é feita em ÍNDICE DE DIA (dias inteiros desde a época, no fuso de SP),
// o que torna o posicionamento estável e independente do fuso do browser.

import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { SP_TZ } from "./utils";

const DAY_MS = 86_400_000;

/** Chave de dia (yyyy-MM-dd) no fuso de SP a partir de um ISO/Date. */
export function spDayKey(d: string | Date): string {
  return formatInTimeZone(typeof d === "string" ? new Date(d) : d, SP_TZ, "yyyy-MM-dd");
}

/** Índice inteiro de dia a partir de uma chave yyyy-MM-dd. */
export function dayKeyToIndex(key: string): number {
  return Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
}

/** Índice de dia (SP) de um ISO/Date. */
export function dayIndexOf(d: string | Date): number {
  return dayKeyToIndex(spDayKey(d));
}

/** Índice do dia de hoje (SP). */
export function todayIndex(): number {
  return dayKeyToIndex(spDayKey(new Date()));
}

// Date UTC (00:00) que representa um índice — usado só pra ROTULAR. Como o índice nasceu de
// uma chave de dia, formatar em UTC devolve o mesmo y/m/d (sem deslocar o fuso de novo).
function idxToUTC(idx: number): Date {
  return new Date(idx * DAY_MS);
}

/** Formata um índice de dia (ex.: "dd/MM", "LLL yyyy", "d"). Sempre em UTC (ver acima). */
export function labelIdx(idx: number, fmt: string): string {
  return formatInTimeZone(idxToUTC(idx), "UTC", fmt, { locale: ptBR });
}

// ── geometria por tarefa ──────────────────────────────────────────────
export type TaskGeom =
  | { kind: "bar"; startIdx: number; endIdx: number }
  | { kind: "milestone"; idx: number }
  | null;

/** Híbrido: início + prazo → barra de duração; só uma das datas → marco; nenhuma → null (gaveta). */
export function geomOf(t: { inicio?: string | null; prazo: string | null }): TaskGeom {
  const hasInicio = !!t.inicio;
  const hasPrazo = !!t.prazo;
  if (hasInicio && hasPrazo) {
    let a = dayIndexOf(t.inicio as string);
    let b = dayIndexOf(t.prazo as string);
    if (b < a) [a, b] = [b, a];
    return { kind: "bar", startIdx: a, endIdx: b };
  }
  if (hasPrazo) return { kind: "milestone", idx: dayIndexOf(t.prazo as string) };
  if (hasInicio) return { kind: "milestone", idx: dayIndexOf(t.inicio as string) };
  return null;
}

/** Índice de ordenação de uma tarefa (começo da barra / data do marco; sem data → +∞). */
export function sortIdxOf(t: { inicio?: string | null; prazo: string | null }): number {
  const g = geomOf(t);
  if (!g) return Number.POSITIVE_INFINITY;
  return g.kind === "bar" ? g.startIdx : g.idx;
}

// ── domínio + eixos ───────────────────────────────────────────────────
export type Domain = { startIdx: number; endIdx: number; days: number };

/** Domínio da timeline: cobre todas as datas + hoje, com folga, começando numa segunda
 *  (semana cheia, header limpo) e com largura mínima de ~3 semanas. */
export function buildDomain(idxs: number[], today: number, padDays = 3): Domain {
  const all = idxs.length ? idxs : [today];
  let min = Math.min(today, ...all) - padDays;
  let max = Math.max(today, ...all) + padDays;
  const dow = idxToUTC(min).getUTCDay(); // 0=dom..6=sab
  min -= (dow + 6) % 7; // recua até a segunda anterior
  if (max - min < 21) max = min + 21;
  return { startIdx: min, endIdx: max, days: max - min + 1 };
}

export type MonthSeg = { label: string; startIdx: number; days: number };

/** Faixas de mês pro cabeçalho (uma por mês coberto pelo domínio). */
export function monthSegments(d: Domain): MonthSeg[] {
  const segs: MonthSeg[] = [];
  let cur = d.startIdx;
  const ymOf = (idx: number) => formatInTimeZone(idxToUTC(idx), "UTC", "yyyy-MM");
  while (cur <= d.endIdx) {
    const ym = ymOf(cur);
    let end = cur;
    while (end + 1 <= d.endIdx && ymOf(end + 1) === ym) end++;
    segs.push({ label: labelIdx(cur, "LLLL yyyy"), startIdx: cur, days: end - cur + 1 });
    cur = end + 1;
  }
  return segs;
}

export type DayTick = { idx: number; offset: number; isWeekStart: boolean; dom: string };

/** Marcas de dia (offset = dias desde o início do domínio). isWeekStart = segunda-feira. */
export function dayTicks(d: Domain): DayTick[] {
  const ticks: DayTick[] = [];
  for (let i = d.startIdx; i <= d.endIdx; i++) {
    ticks.push({
      idx: i,
      offset: i - d.startIdx,
      isWeekStart: idxToUTC(i).getUTCDay() === 1,
      dom: labelIdx(i, "d"),
    });
  }
  return ticks;
}

// ── eixo adaptável ao zoom ────────────────────────────────────────────
export type AxisTick = {
  idx: number;
  offset: number; // dias desde o início do domínio
  dom: string; // dia do mês ("9")
  wd: string; // dia da semana curto ("seg")
  isWeekStart: boolean; // segunda-feira
  isSunday: boolean;
  isWeekend: boolean;
};

/** Ticks ricos pro eixo — o componente decide o que renderizar conforme o zoom. */
export function axisTicks(d: Domain): AxisTick[] {
  const out: AxisTick[] = [];
  for (let i = d.startIdx; i <= d.endIdx; i++) {
    const dow = idxToUTC(i).getUTCDay(); // 0=dom .. 6=sab
    out.push({
      idx: i,
      offset: i - d.startIdx,
      dom: labelIdx(i, "d"),
      wd: labelIdx(i, "EEE").replace(/\.$/, ""), // "seg", "ter"… (sem ponto)
      isWeekStart: dow === 1,
      isSunday: dow === 0,
      isWeekend: dow === 0 || dow === 6,
    });
  }
  return out;
}

export type WeekendSeg = { startOffset: number; days: number };

/** Blocos contíguos de fim de semana (sábado+domingo) dentro do domínio, em offset de dia. */
export function weekendSegments(d: Domain): WeekendSeg[] {
  const segs: WeekendSeg[] = [];
  let i = d.startIdx;
  while (i <= d.endIdx) {
    const dow = idxToUTC(i).getUTCDay();
    if (dow === 6 || dow === 0) {
      const start = i;
      while (i <= d.endIdx && (idxToUTC(i).getUTCDay() === 6 || idxToUTC(i).getUTCDay() === 0)) i++;
      segs.push({ startOffset: start - d.startIdx, days: i - start });
    } else {
      i++;
    }
  }
  return segs;
}

/** Chave yyyy-MM-dd de um índice de dia (estável, em UTC — ver idxToUTC acima). */
export function idxToDateKey(idx: number): string {
  return labelIdx(idx, "yyyy-MM-dd");
}

// TODA data e TODA hora da plataforma passam por aqui, e todas falam no
// horário de Brasília. Regra do Vitor, em maiúsculo, 26/08/2026.
//
// POR QUE ISTO EXISTE
// O servidor roda em UTC (conferido em produção: `TZ=` vazio, `date` em UTC) e
// o banco também (`SHOW timezone` = Etc/UTC). Todo cálculo feito com
// `new Date().getDate()`, `d.getHours()` ou `toLocaleDateString()` usa o fuso
// de QUEM está rodando. Resultado: das 21h às 24h de Brasília o servidor já
// está no dia seguinte, e uma tarefa marcada pra "hoje" nascia amanhã. Quem
// abre o link do quadro de fora do Brasil via tudo trocado.
//
// COMO USAR
// - Precisa saber em que DIA um instante caiu? `diaBR`.
// - Precisa de "hoje"? `hojeBR()`. Nunca `new Date()` cru.
// - Precisa da distância em dias? `diasAteBR`. Nunca subtrair milissegundos.
// - Precisa mostrar? `dataCurtaBR`, `dataBR`, `horaBR`, `dataHoraBR`, `quandoBR`.
// - Campo <input type="date">? `paraCampoBR` na ida, `inicioDoDiaBR` /
//   `fimDoDiaBR` na volta — as duas devolvem o instante certo EM BRASÍLIA.
//
// A garantia está em `data-br.test.ts`: a mesma bateria roda com TZ=UTC e com
// TZ=Asia/Tokyo e tem que dar exatamente a mesma resposta.
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

export const FUSO_BR = "America/Sao_Paulo";

export type Instante = Date | string | number;

/** Aceita o que vier do banco (ISO), de um input, ou um Date. */
function instante(d: Instante): Date {
  const x = d instanceof Date ? d : new Date(d);
  return x;
}

export function ehDataValida(d: Instante | null | undefined): boolean {
  if (d === null || d === undefined || d === "") return false;
  return !Number.isNaN(instante(d).getTime());
}

// ── o dia em que a coisa caiu, em Brasília ────────────────────────────

/** "2026-08-26" — o dia de Brasília em que este instante caiu. */
export const diaBR = (d: Instante): string =>
  formatInTimeZone(instante(d), FUSO_BR, "yyyy-MM-dd");

/** O dia de hoje em Brasília, mesmo com o servidor em UTC. */
export const hojeBR = (agora: Instante = new Date()): string => diaBR(agora);

/** Quantos dias de Brasília separam os dois instantes (alvo − base).
 *  Positivo = o alvo é no futuro. Conta DIAS de calendário, não 24h. */
export function diasAteBR(alvo: Instante, base: Instante = new Date()): number {
  const a = Date.parse(`${diaBR(alvo)}T00:00:00Z`);
  const b = Date.parse(`${diaBR(base)}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

export const ehHojeBR = (d: Instante, agora: Instante = new Date()) => diasAteBR(d, agora) === 0;
export const ehOntemBR = (d: Instante, agora: Instante = new Date()) => diasAteBR(d, agora) === -1;
export const ehAmanhaBR = (d: Instante, agora: Instante = new Date()) => diasAteBR(d, agora) === 1;
export const jaPassouBR = (d: Instante, agora: Instante = new Date()) => diasAteBR(d, agora) < 0;

/** Dia da semana em Brasília: 0 = domingo. */
export const diaDaSemanaBR = (d: Instante = new Date()): number =>
  Number(formatInTimeZone(instante(d), FUSO_BR, "i")) % 7;

// ── mostrar ───────────────────────────────────────────────────────────

const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "sex 14/08" */
export const dataCurtaBR = (d: Instante): string =>
  `${DIA_CURTO[diaDaSemanaBR(d)]} ${formatInTimeZone(instante(d), FUSO_BR, "dd/MM")}`;

/** "14/08" */
export const diaMesBR = (d: Instante): string =>
  formatInTimeZone(instante(d), FUSO_BR, "dd/MM");

/** "14/08/2026" */
export const dataBR = (d: Instante): string =>
  formatInTimeZone(instante(d), FUSO_BR, "dd/MM/yyyy");

/** "17h00" — como se fala, não "17:00". */
export const horaBR = (d: Instante): string =>
  formatInTimeZone(instante(d), FUSO_BR, "HH'h'mm");

/** "26/08 às 17h00" */
export const dataHoraBR = (d: Instante): string =>
  `${diaMesBR(d)} às ${horaBR(d)}`;

/** "14 de agosto de 2026 às 17h00" */
export const dataLongaBR = (d: Instante): string =>
  formatInTimeZone(instante(d), FUSO_BR, "dd 'de' LLLL 'de' yyyy 'às' HH'h'mm", { locale: ptBR });

/** Pra "quando isso aconteceu": "hoje 17h00", "ontem", "14/08", "14/08/2025". */
export function quandoBR(d: Instante | null | undefined): string {
  if (!ehDataValida(d)) return "";
  const alvo = d as Instante;
  const dias = diasAteBR(alvo);
  if (dias === 0) return `hoje ${horaBR(alvo)}`;
  if (dias === -1) return `ontem ${horaBR(alvo)}`;
  const mesmoAno =
    formatInTimeZone(instante(alvo), FUSO_BR, "yyyy") ===
    formatInTimeZone(new Date(), FUSO_BR, "yyyy");
  return mesmoAno ? diaMesBR(alvo) : dataBR(alvo);
}

/** "hoje", "ontem", "há 8 dias", "12/08" — pra "está aqui desde quando". */
export function haQuantoTempoBR(d: Instante | null | undefined): string | null {
  if (!ehDataValida(d)) return null;
  const alvo = d as Instante;
  const dias = -diasAteBR(alvo);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return diaMesBR(alvo);
}

// ── campos de data ────────────────────────────────────────────────────

/** Instante → "yyyy-MM-dd" pro <input type="date">, lido em Brasília. */
export const paraCampoBR = (d: Instante | null | undefined): string =>
  ehDataValida(d) ? diaBR(d as Instante) : "";

/** "yyyy-MM-dd" → o instante das 00:00 EM BRASÍLIA daquele dia. */
export function inicioDoDiaBR(dia: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  return fromZonedTime(`${dia} 00:00:00`, FUSO_BR).toISOString();
}

/** "yyyy-MM-dd" → o instante das 23:59 EM BRASÍLIA daquele dia.
 *  É o que um prazo quer dizer: "até o fim daquele dia, aqui". */
export function fimDoDiaBR(dia: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  return fromZonedTime(`${dia} 23:59:00`, FUSO_BR).toISOString();
}

// ── andar no calendário sem sair de Brasília ──────────────────────────

/** Soma dias ao dia de Brasília e devolve "yyyy-MM-dd". */
export function maisDiasBR(n: number, base: Instante = new Date()): string {
  const b = Date.parse(`${diaBR(base)}T12:00:00Z`);
  return new Date(b + n * 86_400_000).toISOString().slice(0, 10);
}

/** O próximo dia da semana (0=domingo) a partir de hoje em Brasília.
 *  Hoje é sexta e você pede sexta? Devolve a sexta que vem. */
export function proximoDiaDaSemanaBR(alvo: number, base: Instante = new Date()): string {
  const delta = ((alvo - diaDaSemanaBR(base) + 7) % 7) || 7;
  return maisDiasBR(delta, base);
}

/** Domingo que abre a semana de hoje, em Brasília. */
export const inicioDaSemanaBR = (base: Instante = new Date()): string =>
  maisDiasBR(-diaDaSemanaBR(base), base);

/** Sábado que fecha a semana de hoje, em Brasília. */
export const fimDaSemanaBR = (base: Instante = new Date()): string =>
  maisDiasBR(6 - diaDaSemanaBR(base), base);

/** Primeiro dia do mês de hoje, em Brasília. */
export const inicioDoMesBR = (base: Instante = new Date()): string =>
  `${formatInTimeZone(instante(base), FUSO_BR, "yyyy-MM")}-01`;

/** Um Date cujos getDate/getMonth/getDay já respondem em Brasília.
 *  Só pra desenhar calendário; nunca use pra gravar no banco. */
export const relogioBR = (d: Instante = new Date()): Date =>
  toZonedTime(instante(d), FUSO_BR);

/** O ano corrente em Brasília (rodapé, comparações). */
export const anoBR = (d: Instante = new Date()): string =>
  formatInTimeZone(instante(d), FUSO_BR, "yyyy");

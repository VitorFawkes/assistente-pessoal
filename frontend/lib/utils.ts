import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict, isPast } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

export const SP_TZ = "America/Sao_Paulo";

// "Now" expresso no fuso de SP — para cálculos de bucket (filtros).
// O Date retornado tem getHours/getDay/etc. já em SP.
export function nowSP(): Date {
  return toZonedTime(new Date(), SP_TZ);
}

// Converte qualquer Date/ISO para "tempo SP" — comparações entre instâncias
// vindas daqui são coerentes (mesmo deslocamento aplicado).
export function toSP(d: Date | string): Date {
  return toZonedTime(typeof d === "string" ? new Date(d) : d, SP_TZ);
}

// Normaliza o "dono" de uma tarefa pra exibição consistente:
//  - vazio / "?"           → "A definir"
//  - "vitor"/"Vitor" (qq)  → "Vitor"
//  - outros                → nome como veio (trim)
export function normalizeOwner(owner: string | null | undefined): string {
  const s = (owner ?? "").trim();
  if (!s || s === "?") return "A definir";
  if (s.toLowerCase() === "vitor") return "Vitor";
  return s;
}

// "Eu" = dono é o próprio usuário (vitor / vazio / "?").
export function isOwnerMe(owner: string | null | undefined): boolean {
  const s = (owner ?? "").trim().toLowerCase();
  return !s || s === "?" || s === "vitor";
}

// Deriva a ação a partir do nome do dono, mantendo o invariante do sistema
// (executar ⇔ é sua; qualquer outro dono ⇒ cobrar). Usado ao trocar o dono
// direto pelo nome — o conceito de "cobro/aguardo" saiu da edição inline, mas
// a coluna `acao` continua coerente pra filtros/plano/agrupamento.
export function acaoForOwner(owner: string | null | undefined): "executar" | "cobrar" {
  return isOwnerMe(owner) ? "executar" : "cobrar";
}

function dayKeySP(d: Date): string {
  return formatInTimeZone(d, SP_TZ, "yyyy-MM-dd");
}

function isTodaySP(d: Date): boolean {
  return dayKeySP(d) === dayKeySP(new Date());
}

function isYesterdaySP(d: Date): boolean {
  return dayKeySP(d) === dayKeySP(new Date(Date.now() - 86_400_000));
}

function isTomorrowSP(d: Date): boolean {
  return dayKeySP(d) === dayKeySP(new Date(Date.now() + 86_400_000));
}

function isThisYearSP(d: Date): boolean {
  return formatInTimeZone(d, SP_TZ, "yyyy") ===
    formatInTimeZone(new Date(), SP_TZ, "yyyy");
}

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type Prioridade = "baixa" | "media" | "alta" | "urgente";

export function prioridadeBadge(p: Prioridade): { dot: string; label: string } {
  switch (p) {
    case "urgente":
      return { dot: "bg-red-500", label: "Urgente" };
    case "alta":
      return { dot: "bg-orange-500", label: "Alta" };
    case "baixa":
      return { dot: "bg-zinc-400", label: "Baixa" };
    default:
      return { dot: "bg-amber-400", label: "Média" };
  }
}

export function formatPrazo(iso: string | null | undefined): {
  text: string;
  status: "vencida" | "hoje" | "amanha" | "futuro" | "sem-prazo";
} {
  if (!iso) return { text: "sem prazo", status: "sem-prazo" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { text: "sem prazo", status: "sem-prazo" };

  if (isTodaySP(date)) return { text: "hoje", status: "hoje" };
  if (isTomorrowSP(date)) return { text: "amanhã", status: "amanha" };
  if (isPast(date))
    return {
      text: `vencida há ${formatDistanceToNowStrict(date, { locale: ptBR })}`,
      status: "vencida",
    };
  return {
    text: `em ${formatDistanceToNowStrict(date, { locale: ptBR })}`,
    status: "futuro",
  };
}

export function formatPrazoColor(status: ReturnType<typeof formatPrazo>["status"]): string {
  switch (status) {
    case "vencida":
      return "text-red-600 dark:text-red-400";
    case "hoje":
      return "text-orange-600 dark:text-orange-400";
    case "amanha":
      return "text-amber-600 dark:text-amber-400";
    case "futuro":
      return "text-zinc-600 dark:text-zinc-400";
    default:
      return "text-zinc-400 dark:text-zinc-500";
  }
}

export function fmtDate(iso: string): string {
  return formatInTimeZone(new Date(iso), SP_TZ, "dd 'de' LLLL 'de' yyyy 'às' HH:mm", { locale: ptBR });
}

export function fmtDateShort(iso: string): string {
  return formatInTimeZone(new Date(iso), SP_TZ, "dd/MM HH:mm", { locale: ptBR });
}

export function formatCreatedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (isTodaySP(date)) return formatInTimeZone(date, SP_TZ, "'hoje' HH:mm", { locale: ptBR });
  if (isYesterdaySP(date)) return formatInTimeZone(date, SP_TZ, "'ontem' HH:mm", { locale: ptBR });
  if (isThisYearSP(date)) return formatInTimeZone(date, SP_TZ, "dd/MM", { locale: ptBR });
  return formatInTimeZone(date, SP_TZ, "dd/MM/yyyy", { locale: ptBR });
}

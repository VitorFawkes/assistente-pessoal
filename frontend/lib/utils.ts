import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { toZonedTime } from "date-fns-tz";
import {
  dataHoraBR,
  dataLongaBR,
  diasAteBR,
  ehDataValida,
  quandoBR,
} from "./data-br";

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
  // Tudo contado em dias de Brasília: às 22h daqui o servidor está em UTC e já
  // acha que é amanhã, e o que vence hoje aparecia como atrasado.
  if (!ehDataValida(iso)) return { text: "sem prazo", status: "sem-prazo" };
  const dias = diasAteBR(iso!);
  if (dias === 0) return { text: "hoje", status: "hoje" };
  if (dias === 1) return { text: "amanhã", status: "amanha" };
  if (dias < 0) {
    const n = -dias;
    return { text: `vencida há ${n} ${n === 1 ? "dia" : "dias"}`, status: "vencida" };
  }
  return { text: `em ${dias} ${dias === 1 ? "dia" : "dias"}`, status: "futuro" };
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

export const fmtDate = dataLongaBR;
export const fmtDateShort = dataHoraBR;
export const formatCreatedAt = quandoBR;

/** Nome de área legível: as propostas da IA vêm em slug ("midia_paga"). */
export function areaLabel(nome: string): string {
  const s = nome.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return nome;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

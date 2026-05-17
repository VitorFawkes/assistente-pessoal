import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict, format, isPast, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";

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

  if (isToday(date)) return { text: "hoje", status: "hoje" };
  if (isTomorrow(date)) return { text: "amanhã", status: "amanha" };
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
  return format(new Date(iso), "dd 'de' LLLL 'de' yyyy 'às' HH:mm", { locale: ptBR });
}

export function fmtDateShort(iso: string): string {
  return format(new Date(iso), "dd/MM HH:mm", { locale: ptBR });
}

"use client";

import { Lock, Clock, Search, Inbox } from "lucide-react";

type GuestBoardErrorType = "invalid_token" | "rate_limited" | "not_found" | "empty_board";

interface GuestBoardErrorProps {
  type: GuestBoardErrorType;
}

/**
 * Estados de erro e vazio amigáveis para o quadro do convidado.
 * Renderiza ícone, título e mensagem descritiva, centalizados e responsivos.
 * Design tokens: --muted, --muted-strong, --accent
 */
export function GuestBoardError({ type }: GuestBoardErrorProps) {
  const config = {
    invalid_token: {
      icon: Lock,
      title: "Link não está mais válido",
      message: "Solicite um novo link ao dono do quadro.",
      color: "text-[color:var(--urgent)]",
    },
    rate_limited: {
      icon: Clock,
      title: "Muitas tentativas",
      message: "Aguarde um minuto antes de tentar novamente.",
      color: "text-[color:var(--warm)]",
    },
    not_found: {
      icon: Search,
      title: "Quadro não encontrado",
      message: "O quadro pode ter sido deletado ou arquivado.",
      color: "text-[color:var(--muted)]",
    },
    empty_board: {
      icon: Inbox,
      title: "Nenhuma tarefa neste quadro",
      message: "Crie uma usando o composer abaixo!",
      color: "text-[color:var(--muted)]",
    },
  };

  const { icon: Icon, title, message, color } = config[type];

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 px-4">
      <div className={`${color}`}>
        <Icon className="w-20 h-20 sm:w-24 sm:h-24 opacity-60" strokeWidth={1.5} />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-lg sm:text-xl font-display font-light text-[color:var(--muted-strong)]">
          {title}
        </h2>
        <p className="text-sm text-[color:var(--muted)] max-w-sm">
          {message}
        </p>
      </div>
    </div>
  );
}

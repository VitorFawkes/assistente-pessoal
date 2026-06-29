"use client";

import { Lock, Clock, Search, Inbox } from "lucide-react";

type GuestBoardErrorType = "invalid_token" | "rate_limited" | "not_found" | "empty_board";

interface GuestBoardErrorProps {
  type: GuestBoardErrorType;
}

/**
 * Estados de erro e vazio amigáveis para o quadro do convidado.
 * Renderiza um ícone, título e mensagem descritiva centalizados.
 */
export function GuestBoardError({ type }: GuestBoardErrorProps) {
  const config = {
    invalid_token: {
      icon: Lock,
      title: "Link não está mais válido",
      message: "Solicite um novo link ao dono do quadro.",
    },
    rate_limited: {
      icon: Clock,
      title: "Muitas tentativas",
      message: "Aguarde um minuto antes de tentar novamente.",
    },
    not_found: {
      icon: Search,
      title: "Quadro não encontrado",
      message: "O quadro pode ter sido deletado ou arquivado.",
    },
    empty_board: {
      icon: Inbox,
      title: "Nenhuma tarefa neste quadro",
      message: "Crie uma usando o composer abaixo!",
    },
  };

  const { icon: Icon, title, message } = config[type];

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Icon
        className="w-16 h-16 text-[color:var(--muted)]"
        strokeWidth={1.5}
      />
      <h2 className="text-lg font-medium text-center text-[color:var(--muted-strong)]">
        {title}
      </h2>
      <p className="text-sm text-center text-[color:var(--muted)]">
        {message}
      </p>
    </div>
  );
}

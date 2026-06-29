"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AtividadeItem } from "@/lib/quadros";

interface ActivityFeedProps {
  items: AtividadeItem[];
}

/**
 * Feed de atividade auditada — mostra eventos de tarefas (criação, edição, deleção)
 * com nomes de convidados e timestamps relativos.
 * Design tokens: --muted, --foreground, --accent, --calm
 */
export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[color:var(--muted)]">Nenhuma atividade ainda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const avatar = item.convidado_nome ? item.convidado_nome.charAt(0).toUpperCase() : "V";
        const author = item.convidado_nome || "Você";
        const timestamp = new Date(item.criado_em);
        const timeAgo = formatDistanceToNowStrict(timestamp, {
          locale: ptBR,
          addSuffix: true,
        });

        // Traduzir evento para texto amigável
        const actionText = (() => {
          switch (item.evento) {
            case "criada":
              return "criou";
            case "deletada":
              return "deletou";
            case "editada":
              return "editou";
            default:
              return item.evento;
          }
        })();

        return (
          <div key={item.id} className="flex gap-3 pb-3 border-b border-[color:var(--border)] last:border-0">
            {/* Avatar */}
            <div className="flex-shrink-0">
              <div
                className="w-8 h-8 rounded-full bg-[color:var(--calm)] text-white flex items-center justify-center text-xs font-medium"
                title={author}
              >
                {avatar}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium text-[color:var(--foreground)]">{author}</span>
                  {" "}
                  <span className="text-[color:var(--muted)]">{actionText}</span>
                </div>
                <div className="text-xs text-[color:var(--muted)] whitespace-nowrap">
                  {timeAgo}
                </div>
              </div>
              <div className="text-sm text-[color:var(--muted)] truncate mt-1">
                <a
                  href={`/tarefas/${item.tarefa_id}`}
                  className="hover:text-[color:var(--accent)] hover:underline transition-colors"
                  title={item.tarefa_titulo}
                >
                  "{item.tarefa_titulo}"
                </a>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

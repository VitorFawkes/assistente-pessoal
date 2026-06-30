"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AtividadeItem } from "@/lib/quadros";

interface ActivityFeedProps {
  items: AtividadeItem[];
}

// evento → verbo legível
const VERBO: Record<string, string> = {
  criada: "criou",
  concluida: "concluiu",
  cancelada: "cancelou",
  reaberta: "reabriu",
  editada: "editou",
  deletada: "removeu",
};

// nomes técnicos de campo → rótulo em pt-BR (pro detalhe do "editou")
const CAMPO_PT: Record<string, string> = {
  titulo: "título",
  descricao: "descrição",
  owner: "responsável",
  acao: "ação",
  prazo: "prazo",
  prazo_text: "prazo",
  prioridade: "prioridade",
  area_raw: "área",
  frente_id: "área",
  status: "status",
  pessoas: "pessoas",
  no_plano: "plano",
  inicio: "início",
};

// Extrai a lista de campos alterados do payload de um evento "editada".
function camposEditados(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const changed = payload["changed"];
  if (changed && typeof changed === "object") {
    return [...new Set(Object.keys(changed as object).map((k) => CAMPO_PT[k] ?? k))];
  }
  return [];
}

/**
 * Feed de atividade auditada — quem fez o quê em cada tarefa do quadro.
 * Convidado pelo nome; dono = "Vitor". Verbo claro por evento + campos no "editou".
 */
export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-[color:var(--muted)] py-2">Nenhuma atividade ainda.</p>
    );
  }

  return (
    <ul className="space-y-3.5">
      {items.map((item) => {
        const author = item.convidado_nome || "Vitor";
        const avatar = author.charAt(0).toUpperCase();
        const timeAgo = formatDistanceToNowStrict(new Date(item.criado_em), {
          locale: ptBR,
          addSuffix: true,
        });
        let verbo = VERBO[item.evento] ?? item.evento;
        if (item.evento === "editada") {
          const campos = camposEditados(item.payload);
          if (campos.length) verbo = `editou ${campos.join(", ")} de`;
        }
        const titulo = item.tarefa_titulo || "uma tarefa";

        return (
          <li key={item.id} className="flex gap-2.5">
            <span
              className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)] flex items-center justify-center text-[11px] font-semibold"
              title={author}
            >
              {avatar}
            </span>
            <div className="min-w-0 flex-1 text-[13px] leading-snug">
              <span className="text-[color:var(--foreground)]">
                <span className="font-medium">{author}</span>{" "}
                <span className="text-[color:var(--muted-strong)]">{verbo}</span>{" "}
                <span className="text-[color:var(--muted-strong)]">“{titulo}”</span>
              </span>
              <span className="block text-[11px] text-[color:var(--muted)] mt-0.5">
                {timeAgo}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

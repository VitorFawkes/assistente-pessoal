"use client";

// Convidados e histórico do quadro, num menu que abre por cima.
//
// Antes isso era uma coluna fixa de 340px ao lado do quadro. Ela comia a
// largura das tarefas: no Kanban sobrava espaço pra 3 colunas e a quarta
// ("Feito") ia parar embaixo de tudo. Agora o quadro fica com a tela inteira
// e isto abre só quando alguém pede.
//
// Espelhado na janela "Adicionar tarefas ao quadro": fecha no Esc e no clique
// fora, escurece o fundo, trava a rolagem atrás e vira gaveta no celular.
import { useEffect, useState } from "react";
import { Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConvidadosManager } from "./convidados-manager";
import { ActivityFeed } from "./activity-feed";
import type { AtividadeItem } from "@/lib/quadros";

type Convidado = {
  id: string;
  nome: string;
  token: string;
  created_at: string;
  last_seen_at: string | null;
};

export function QuadroPainel({
  convidados,
  onCreate,
  onCreateBulk,
  onRevoke,
  /** Só o dono tem histórico; pelo link do convidado ele não é carregado. */
  atividade,
}: {
  convidados: Convidado[];
  onCreate: (nome: string) => Promise<void>;
  onCreateBulk: (nomes: string[]) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  atividade?: AtividadeItem[];
}) {
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<"convidados" | "atividade">("convidados");
  const temAtividade = Array.isArray(atividade);

  useEffect(() => {
    if (!aberto) return;
    document.body.style.overflow = "hidden";
    function naTecla(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    window.addEventListener("keydown", naTecla);
    return () => {
      window.removeEventListener("keydown", naTecla);
      document.body.style.overflow = "";
    };
  }, [aberto]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-1.5 text-[12.5px] font-medium text-[color:var(--muted-strong)] hover:border-[color:var(--muted)] hover:text-[color:var(--foreground)] transition whitespace-nowrap"
      >
        <Users size={13} strokeWidth={2} />
        Convidados
        {convidados.length > 0 && (
          <span className="text-[11px] font-bold text-[color:var(--muted)]">
            {convidados.length}
          </span>
        )}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAberto(false);
          }}
        >
          <div className="w-full sm:max-w-lg bg-[color:var(--card)] border border-[color:var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh]">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="font-display text-xl">
                {temAtividade ? "Convidados e histórico" : "Convidados"}
              </h2>
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar"
                className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
              >
                <X size={18} />
              </button>
            </div>

            {temAtividade && (
              <div className="px-5 pb-3 flex gap-1">
                {(["convidados", "atividade"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAba(v)}
                    aria-pressed={aba === v}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-[12.5px] font-medium transition capitalize",
                      aba === v
                        ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                        : "text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]",
                    )}
                  >
                    {v === "convidados" ? "Convidados" : "Histórico"}
                  </button>
                ))}
              </div>
            )}

            <div className="px-5 pb-5 overflow-y-auto">
              {temAtividade && aba === "atividade" ? (
                <ActivityFeed items={atividade!} />
              ) : (
                <ConvidadosManager
                  convidados={convidados}
                  onCreate={onCreate}
                  onCreateBulk={onCreateBulk}
                  onRevoke={onRevoke}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

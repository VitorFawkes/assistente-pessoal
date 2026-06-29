"use client";

import { useState } from "react";
import { toast } from "sonner";
import type {
  Quadro,
  QuadroConvidado,
  AtividadeItem,
} from "@/lib/quadros";
import type { Tarefa } from "@/lib/queries";
import { ActivityFeed } from "./activity-feed";
import { CopyLinkButton } from "./copy-link-button";

interface QuadroManagerProps {
  quadro: Quadro;
  tarefas: Tarefa[];
  convidados: QuadroConvidado[];
  atividade: AtividadeItem[];
}

export function QuadroManager({
  quadro: initialQuadro,
  tarefas: initialTarefas,
  convidados: initialConvidados,
  atividade,
}: QuadroManagerProps) {
  const [quadro, setQuadro] = useState(initialQuadro);
  const [convidados, setConvidados] = useState(initialConvidados);
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [newConvidadoName, setNewConvidadoName] = useState("");
  const [creatingConvidado, setCreatingConvidado] = useState(false);

  const handleUpdateQuadro = async (updates: Partial<Quadro>) => {
    try {
      const res = await fetch(`/api/quadros/${quadro.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Erro ao atualizar");
      const updated = await res.json();
      setQuadro(updated);
      toast.success("Quadro atualizado");
      setEditingName(false);
      setEditingDesc(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
    }
  };

  const handleCreateConvidado = async () => {
    if (!newConvidadoName.trim()) return;
    setCreatingConvidado(true);
    try {
      const res = await fetch(`/api/quadros/${quadro.id}/convidados`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: newConvidadoName }),
      });
      if (!res.ok) throw new Error("Erro ao criar convidado");
      const result = await res.json();
      setConvidados((prev) => [
        ...prev,
        {
          id: result.id,
          quadro_id: quadro.id,
          nome: result.nome,
          token: result.token,
          created_at: new Date().toISOString(),
          last_seen_at: null,
          revoked_at: null,
        },
      ]);
      setNewConvidadoName("");
      toast.success(`Convidado criado: ${result.nome}`);

      // Copy link to clipboard — monta com a origin atual (não depende de
      // NEXT_PUBLIC_BASE_URL, que pode não estar setada em prod).
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      await navigator.clipboard.writeText(`${baseUrl}/q/${result.token}`);
      toast.success("Link copiado!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setCreatingConvidado(false);
    }
  };

  const handleRevokeConvidado = async (convidadoId: string) => {
    try {
      const res = await fetch(`/api/quadros/${quadro.id}/convidados/${convidadoId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erro ao revogar");
      setConvidados((prev) => prev.filter((c) => c.id !== convidadoId));
      toast.success("Convidado revogado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Cabeçalho editável */}
      <section className="space-y-4 border-b-2 border-[color:var(--border)] pb-8">
        {editingName ? (
          <input
            type="text"
            value={quadro.nome}
            onChange={(e) => setQuadro({ ...quadro, nome: e.target.value })}
            onBlur={() => handleUpdateQuadro({ nome: quadro.nome })}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUpdateQuadro({ nome: quadro.nome });
            }}
            autoFocus
            className="font-display text-3xl sm:text-4xl border-b-2 border-[color:var(--accent)] bg-transparent outline-none text-[color:var(--foreground)]"
          />
        ) : (
          <h1
            onClick={() => setEditingName(true)}
            className="font-display text-3xl sm:text-4xl cursor-pointer hover:opacity-60 transition-opacity text-[color:var(--foreground)]"
          >
            {quadro.nome}
          </h1>
        )}

        {editingDesc ? (
          <textarea
            value={quadro.descricao || ""}
            onChange={(e) =>
              setQuadro({ ...quadro, descricao: e.target.value || null })
            }
            onBlur={() =>
              handleUpdateQuadro({ descricao: quadro.descricao })
            }
            autoFocus
            className="w-full border border-[color:var(--border)] rounded-lg p-3 text-sm bg-[color:var(--card)] text-[color:var(--foreground)]"
            rows={3}
          />
        ) : (
          <p
            onClick={() => setEditingDesc(true)}
            className="text-sm text-[color:var(--muted-strong)] cursor-pointer hover:opacity-60 transition-opacity"
          >
            {quadro.descricao || "Adicione uma descrição..."}
          </p>
        )}
      </section>

      {/* Convidados e Atividade - Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
        {/* Coluna esquerda: Tarefas (2 cols em lg) */}
        <div className="lg:col-span-2">
          {/* Tarefas seção será renderizada pelo parent */}
        </div>

        {/* Coluna direita: Convidados + Atividade (1 col em lg) */}
        <div className="lg:col-span-1 space-y-8">
          {/* Convidados */}
          <section className="space-y-6">
            <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
              Convidados
            </h3>
            <div className="space-y-3">
              {convidados.length === 0 ? (
                <p className="text-sm text-[color:var(--muted)]">Nenhum convidado ainda.</p>
              ) : (
                convidados.map((c) => {
                  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
                  const link = `${baseUrl}/q/${c.token}`;
                  return (
                    <div
                      key={c.id}
                      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-4 sm:p-5 space-y-3 hover:border-[color:var(--accent)] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[color:var(--foreground)]">{c.nome}</p>
                          <p className="text-xs text-[color:var(--muted)]">
                            {new Date(c.created_at).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRevokeConvidado(c.id)}
                          className="px-3 py-1 rounded-lg text-xs font-medium bg-[color:var(--urgent)] text-white hover:opacity-80 transition-opacity whitespace-nowrap flex-shrink-0"
                        >
                          Revogar
                        </button>
                      </div>
                      {/* Copiar link */}
                      <div className="pt-2 border-t border-[color:var(--border)]">
                        <CopyLinkButton link={link} label="Copiar link" variant="button" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Nome do novo convidado..."
                value={newConvidadoName}
                onChange={(e) => setNewConvidadoName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateConvidado();
                }}
                className="flex-1 rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm bg-[color:var(--card)] text-[color:var(--foreground)] focus:border-[color:var(--accent)] outline-none transition-colors"
              />
              <button
                onClick={handleCreateConvidado}
                disabled={creatingConvidado || !newConvidadoName.trim()}
                className="px-4 py-2 rounded-lg bg-[color:var(--calm)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
              >
                {creatingConvidado ? "Criando..." : "Criar"}
              </button>
            </div>
          </section>

          {/* Atividade */}
          <section className="space-y-6 border-t-2 border-[color:var(--border)] lg:border-t-0 lg:border-l-2 lg:pl-8 pt-8 lg:pt-0">
            <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
              Atividade
            </h3>
            <div className="max-h-96 overflow-y-auto pr-2">
              <ActivityFeed items={atividade} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

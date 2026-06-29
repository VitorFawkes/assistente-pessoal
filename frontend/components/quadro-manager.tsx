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

      // Copy link to clipboard
      await navigator.clipboard.writeText(result.link);
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
    <div className="space-y-8">
      {/* Cabeçalho editável */}
      <section className="space-y-4 border-b border-[color:var(--border)] pb-6">
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
            className="font-display text-3xl border-b-2 border-[color:var(--accent)] bg-transparent outline-none"
          />
        ) : (
          <h1
            onClick={() => setEditingName(true)}
            className="font-display text-3xl cursor-pointer hover:opacity-60"
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
            className="w-full border border-[color:var(--border)] rounded p-2 text-sm"
            rows={3}
          />
        ) : (
          <p
            onClick={() => setEditingDesc(true)}
            className="text-sm text-[color:var(--muted-strong)] cursor-pointer hover:opacity-60"
          >
            {quadro.descricao || "Adicione uma descrição..."}
          </p>
        )}
      </section>

      {/* Convidados e Atividade - Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Coluna esquerda: Tarefas (2 cols em lg) */}
        <div className="lg:col-span-2">
          {/* Tarefas seção será renderizada pelo parent */}
        </div>

        {/* Coluna direita: Convidados + Atividade (1 col em lg) */}
        <div className="lg:col-span-1 space-y-8">
          {/* Convidados */}
          <section className="space-y-4">
            <h3 className="font-display text-lg font-semibold">Convidados</h3>
            <div className="space-y-3">
              {convidados.map((c) => {
                const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
                const link = `${baseUrl}/q/${c.token}`;
                return (
                  <div
                    key={c.id}
                    className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{c.nome}</p>
                        <p className="text-xs text-[color:var(--muted)]">
                          Criado {new Date(c.created_at).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRevokeConvidado(c.id)}
                        className="px-2 py-1 rounded text-xs bg-[color:var(--urgent)] text-white hover:opacity-80 whitespace-nowrap"
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
              })}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nome do novo convidado..."
                value={newConvidadoName}
                onChange={(e) => setNewConvidadoName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateConvidado();
                }}
                className="flex-1 rounded border border-[color:var(--border)] px-3 py-2 text-sm"
              />
              <button
                onClick={handleCreateConvidado}
                disabled={creatingConvidado || !newConvidadoName.trim()}
                className="px-4 py-2 rounded bg-[color:var(--calm)] text-white text-sm hover:opacity-80 disabled:opacity-50"
              >
                {creatingConvidado ? "Criando..." : "Criar"}
              </button>
            </div>
          </section>

          {/* Atividade */}
          <section className="space-y-4 border-t border-[color:var(--border)] pt-6">
            <h3 className="font-display text-lg font-semibold">Atividade</h3>
            <ActivityFeed items={atividade} />
          </section>
        </div>
      </div>
    </div>
  );
}

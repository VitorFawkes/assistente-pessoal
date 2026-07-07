"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { Quadro, QuadroConvidado, AtividadeItem } from "@/lib/quadros";
import type { Tarefa } from "@/lib/queries";
import { OwnerTaskProvider } from "@/lib/task-mutations";
import { TaskBoardView } from "./task-board-view";
import { PlanoTimeline } from "./plano-timeline";
import { ActivityFeed } from "./activity-feed";
import { CopyLinkButton } from "./copy-link-button";
import { TaskPickerModal } from "./task-picker-modal";

interface QuadroManagerProps {
  quadro: Quadro;
  tarefas: Tarefa[];
  convidados: QuadroConvidado[];
  atividade: AtividadeItem[];
}

export function QuadroManager({
  quadro: initialQuadro,
  tarefas,
  convidados: initialConvidados,
  atividade,
}: QuadroManagerProps) {
  const router = useRouter();
  const [quadro, setQuadro] = useState(initialQuadro);
  const [convidados, setConvidados] = useState(initialConvidados);
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [newConvidadoName, setNewConvidadoName] = useState("");
  const [creatingConvidado, setCreatingConvidado] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [creatingBulk, setCreatingBulk] = useState(false);

  // ─── Tarefas: criar / adicionar existentes ────────────────────────────
  const [novaTarefa, setNovaTarefa] = useState("");
  const [criandoTarefa, setCriandoTarefa] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ─── Visão: Lista (board) ou Linha do tempo (Gantt = "plano") ─────────
  const [vista, setVista] = useState<"lista" | "timeline">(
    initialQuadro.vista_padrao,
  );

  // Troca a visão e persiste (é o "transformar em plano"). Otimista + reverte no erro.
  const mudarVista = async (nova: "lista" | "timeline") => {
    if (nova === vista) return;
    const prev = vista;
    setVista(nova);
    try {
      const res = await fetch(`/api/quadros/${quadro.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vista_padrao: nova }),
      });
      if (!res.ok) throw new Error("Erro ao mudar a visão");
    } catch (e) {
      setVista(prev);
      toast.error(e instanceof Error ? e.message : "Erro ao mudar a visão");
    }
  };

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

  // Cria a tarefa e já vincula ao quadro (2 chamadas: POST tarefa → POST link).
  const criarTarefaNoQuadro = async () => {
    const titulo = novaTarefa.trim();
    if (!titulo) return;
    setCriandoTarefa(true);
    try {
      const res = await fetch("/api/tarefas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Erro ao criar tarefa");
      }
      const tarefa = (await res.json()) as { id: string };
      const link = await fetch(`/api/quadros/${quadro.id}/tarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarefaIds: [tarefa.id] }),
      });
      if (!link.ok) throw new Error("Tarefa criada, mas falhou ao vincular ao quadro");
      setNovaTarefa("");
      toast.success("Tarefa criada no quadro");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setCriandoTarefa(false);
    }
  };

  const removerDoQuadro = async (tarefaId: string) => {
    try {
      const res = await fetch(`/api/quadros/${quadro.id}/tarefas/${tarefaId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erro ao remover do quadro");
      toast.success("Removida do quadro");
      router.refresh();
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
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      await navigator.clipboard.writeText(`${baseUrl}/q/${result.token}`);
      toast.success("Link copiado!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setCreatingConvidado(false);
    }
  };

  // Nomes válidos do lote: uma linha = um nome, sem vazios, sem duplicatas exatas.
  const bulkNomes = [
    ...new Set(
      bulkText
        .split("\n")
        .map((n) => n.trim())
        .filter((n) => n.length > 0),
    ),
  ];

  const handleCreateConvidadosBulk = async () => {
    if (bulkNomes.length === 0) return;
    setCreatingBulk(true);
    try {
      const res = await fetch(`/api/quadros/${quadro.id}/convidados`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomes: bulkNomes }),
      });
      if (!res.ok) throw new Error("Erro ao criar convidados");
      const { convidados: criados } = await res.json();
      setConvidados((prev) => [
        ...prev,
        ...criados.map((c: { id: string; nome: string; token: string }) => ({
          id: c.id,
          quadro_id: quadro.id,
          nome: c.nome,
          token: c.token,
          created_at: new Date().toISOString(),
          last_seen_at: null,
          revoked_at: null,
        })),
      ]);
      setBulkText("");
      setBulkOpen(false);
      toast.success(
        `${criados.length} ${criados.length === 1 ? "convidado criado" : "convidados criados"}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setCreatingBulk(false);
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
    <OwnerTaskProvider>
      <div className="w-full space-y-8 pb-16">
        {/* Cabeçalho editável */}
        <section className="space-y-3 border-b border-[color:var(--border)] pb-6">
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
              onBlur={() => handleUpdateQuadro({ descricao: quadro.descricao })}
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

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-8 lg:gap-12 items-start">
          {/* Coluna esquerda: Tarefas */}
          <div className="min-w-0 space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
                Tarefas{" "}
                <span className="text-[color:var(--muted)] text-base">
                  {tarefas.length}
                </span>
              </h3>
              <div className="flex items-center gap-3">
                {/* Toggle Lista ↔ Linha do tempo (transformar em plano) */}
                <div className="inline-flex rounded-full border border-[color:var(--border)] p-0.5 text-[12px] font-medium">
                  <button
                    type="button"
                    onClick={() => mudarVista("lista")}
                    className={`px-3 py-1 rounded-full transition ${
                      vista === "lista"
                        ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                        : "text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)]"
                    }`}
                  >
                    Lista
                  </button>
                  <button
                    type="button"
                    onClick={() => mudarVista("timeline")}
                    className={`px-3 py-1 rounded-full transition ${
                      vista === "timeline"
                        ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                        : "text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)]"
                    }`}
                  >
                    Linha do tempo
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="text-sm text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] underline underline-offset-2"
                >
                  Adicionar existentes
                </button>
              </div>
            </div>

            {/* Composer: nova tarefa direto no quadro */}
            <div className="flex items-center gap-2">
              <input
                value={novaTarefa}
                onChange={(e) => setNovaTarefa(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") criarTarefaNoQuadro();
                }}
                placeholder="Nova tarefa neste quadro…"
                className="flex-1 rounded-lg border border-[color:var(--border)] px-4 py-2.5 text-sm bg-[color:var(--card)] text-[color:var(--foreground)] focus:border-[color:var(--accent)] outline-none transition-colors"
              />
              <button
                type="button"
                onClick={criarTarefaNoQuadro}
                disabled={criandoTarefa || !novaTarefa.trim()}
                className="press-feedback inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition whitespace-nowrap"
              >
                <Plus size={15} strokeWidth={2.5} />
                {criandoTarefa ? "Criando…" : "Criar"}
              </button>
            </div>

            {/* Conteúdo por visão: Lista (board) ou Linha do tempo (Gantt) */}
            {vista === "timeline" ? (
              <PlanoTimeline
                tarefas={tarefas}
                quadroId={quadro.id}
                showManageButton={false}
              />
            ) : (
              <TaskBoardView
                tarefas={tarefas}
                onRemoveFromBoard={removerDoQuadro}
              />
            )}
          </div>

          {/* Coluna direita: Convidados + Atividade — um único scroll sticky (sem scrollbar aninhado) */}
          <div className="space-y-8 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1">
            <section className="space-y-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
                  Convidados
                </h3>
                {convidados.length >= 2 &&
                  (() => {
                    const baseUrl =
                      typeof window !== "undefined" ? window.location.origin : "";
                    const bloco = convidados
                      .map((c) => `${c.nome} — ${baseUrl}/q/${c.token}`)
                      .join("\n");
                    return (
                      <CopyLinkButton
                        link={bloco}
                        label="Copiar todos os links"
                        variant="button"
                      />
                    );
                  })()}
              </div>
              <div className="space-y-3">
                {convidados.length === 0 ? (
                  <p className="text-sm text-[color:var(--muted)]">Nenhum convidado ainda.</p>
                ) : (
                  convidados.map((c) => {
                    const baseUrl =
                      typeof window !== "undefined" ? window.location.origin : "";
                    const link = `${baseUrl}/q/${c.token}`;
                    return (
                      <div
                        key={c.id}
                        className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-4 sm:p-5 space-y-3 hover:border-[color:var(--accent)] transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[color:var(--foreground)]">
                              {c.nome}
                            </p>
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

              {bulkOpen ? (
                <div className="space-y-2">
                  <textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={"Um nome por linha…\nAna Souza\nBruno Lima\nCarla Dias"}
                    rows={5}
                    autoFocus
                    className="w-full rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm bg-[color:var(--card)] text-[color:var(--foreground)] focus:border-[color:var(--accent)] outline-none transition-colors resize-y"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCreateConvidadosBulk}
                      disabled={creatingBulk || bulkNomes.length === 0}
                      className="px-4 py-2 rounded-lg bg-[color:var(--calm)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
                    >
                      {creatingBulk
                        ? "Criando…"
                        : `Criar ${bulkNomes.length} ${bulkNomes.length === 1 ? "convidado" : "convidados"}`}
                    </button>
                    <button
                      onClick={() => {
                        setBulkOpen(false);
                        setBulkText("");
                      }}
                      className="px-3 py-2 rounded-lg text-sm text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setBulkOpen(true)}
                  className="text-sm text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] underline underline-offset-2"
                >
                  Colar vários
                </button>
              )}
            </section>

            <section className="space-y-5 border-t border-[color:var(--border)] pt-6">
              <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
                Atividade
              </h3>
              <ActivityFeed items={atividade} />
            </section>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <TaskPickerModal
          quadroId={quadro.id}
          onClose={() => setPickerOpen(false)}
          onAdded={() => router.refresh()}
        />
      )}
    </OwnerTaskProvider>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search, X } from "lucide-react";
import type { Quadro, QuadroConvidado, AtividadeItem } from "@/lib/quadros";
import type { Tarefa } from "@/lib/queries";
import { OwnerTaskProvider } from "@/lib/task-mutations";
import { TaskRow } from "./task-row";
import { ActivityFeed } from "./activity-feed";
import { CopyLinkButton } from "./copy-link-button";
import { formatPrazo } from "@/lib/utils";

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

  // ─── Tarefas: criar / adicionar existentes ────────────────────────────
  const [novaTarefa, setNovaTarefa] = useState("");
  const [criandoTarefa, setCriandoTarefa] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [candidatas, setCandidatas] = useState<Tarefa[]>([]);
  const [loadingCand, setLoadingCand] = useState(false);
  const [selCand, setSelCand] = useState<Set<string>>(new Set());

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

  const abrirPicker = async (q = "") => {
    setPickerOpen(true);
    setLoadingCand(true);
    setSelCand(new Set());
    try {
      const res = await fetch(
        `/api/quadros/${quadro.id}/tarefas?q=${encodeURIComponent(q)}`,
      );
      const data = (await res.json()) as { candidatas?: Tarefa[] };
      setCandidatas(data.candidatas ?? []);
    } catch {
      toast.error("Erro ao buscar tarefas");
    } finally {
      setLoadingCand(false);
    }
  };

  const toggleCand = (id: string) =>
    setSelCand((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const adicionarSelecionadas = async () => {
    const ids = [...selCand];
    if (ids.length === 0) return;
    try {
      const res = await fetch(`/api/quadros/${quadro.id}/tarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarefaIds: ids }),
      });
      if (!res.ok) throw new Error("Erro ao adicionar");
      toast.success(`${ids.length} tarefa${ids.length > 1 ? "s" : ""} adicionada${ids.length > 1 ? "s" : ""}`);
      setPickerOpen(false);
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
          {/* Coluna esquerda: Tarefas */}
          <div className="lg:col-span-2 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
                Tarefas{" "}
                <span className="text-[color:var(--muted)] text-base">
                  {tarefas.length}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => (pickerOpen ? setPickerOpen(false) : abrirPicker(""))}
                className="text-sm text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] underline underline-offset-2"
              >
                {pickerOpen ? "Fechar" : "Adicionar existentes"}
              </button>
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

            {/* Picker de tarefas existentes */}
            {pickerOpen && (
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4 space-y-3">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[color:var(--border)]">
                  <Search size={13} className="text-[color:var(--muted)] shrink-0" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") abrirPicker(busca);
                    }}
                    placeholder="Buscar tarefas existentes…"
                    className="flex-1 bg-transparent text-[13px] outline-none"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                  {loadingCand ? (
                    <p className="text-sm text-[color:var(--muted)] py-4 text-center">Carregando…</p>
                  ) : candidatas.length === 0 ? (
                    <p className="text-sm text-[color:var(--muted)] py-4 text-center">
                      Nenhuma tarefa aberta fora deste quadro.
                    </p>
                  ) : (
                    candidatas.map((t) => {
                      const prazo = formatPrazo(t.prazo);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleCand(t.id)}
                          className="w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-lg border border-[color:var(--border)] hover:bg-[color:var(--accent)]/40 transition"
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              selCand.has(t.id)
                                ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
                                : "border-[color:var(--muted)]/60"
                            }`}
                          >
                            {selCand.has(t.id) && <span className="text-[10px]">✓</span>}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-sm">{t.titulo}</span>
                          {t.prazo && (
                            <span className="text-[11px] text-[color:var(--muted)] shrink-0">
                              {prazo.text}
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(false)}
                    className="text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={adicionarSelecionadas}
                    disabled={selCand.size === 0}
                    className="rounded-full bg-[color:var(--calm)] text-white px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    Adicionar {selCand.size > 0 ? `(${selCand.size})` : ""}
                  </button>
                </div>
              </div>
            )}

            {/* Lista de tarefas do quadro (cards editáveis inline) */}
            {tarefas.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--border)] py-10 px-6 text-center">
                <p className="text-sm text-[color:var(--muted-strong)]">
                  Nenhuma tarefa neste quadro ainda.
                </p>
                <p className="text-xs text-[color:var(--muted)] mt-1">
                  Crie uma acima, ou adicione tarefas que já existem.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {tarefas.map((t) => (
                  <div key={t.id} className="space-y-1">
                    <TaskRow tarefa={t} />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => removerDoQuadro(t.id)}
                        className="text-[11px] text-[color:var(--muted)] hover:text-[color:var(--urgent)] transition"
                      >
                        remover do quadro
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Coluna direita: Convidados + Atividade */}
          <div className="lg:col-span-1 space-y-8">
            <section className="space-y-6">
              <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
                Convidados
              </h3>
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
            </section>

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
    </OwnerTaskProvider>
  );
}

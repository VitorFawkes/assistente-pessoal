"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Quadro, QuadroConvidado, AtividadeItem } from "@/lib/quadros";
import type { Tarefa } from "@/lib/queries";
import { OwnerTaskProvider } from "@/lib/task-mutations";
import { TaskBoardView } from "./task-board-view";
import { QuadroAbas } from "./quadro-abas";
import { QuadroIdeias } from "./quadro-ideias";
import { ideiasDoDono } from "@/lib/ideias-api";
import { QuadroPainel } from "./quadro-painel";
import { QuadroDescricao } from "./quadro-descricao";
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
  const [pagina, setPagina] = useState<"tarefas" | "ideias">("tarefas");
  const [quantasIdeias, setQuantasIdeias] = useState(0);
  
  const apiIdeias = useMemo(
    () => ideiasDoDono(initialQuadro.id, () => router.refresh()),
    [initialQuadro.id, router],
  );

  // conta as ideias pra mostrar no número da aba
  useEffect(() => {
    let vivo = true;
    void apiIdeias
      .listar()
      .then((l) => { if (vivo) setQuantasIdeias(l.length); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [apiIdeias, pagina]);
  const [convidados, setConvidados] = useState(initialConvidados);
  const [editingName, setEditingName] = useState(false);


  // ─── Tarefas: adicionar existentes ──────────────────────────────────
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
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


  const criarConvidado = async (nome: string) => {
    if (!nome.trim()) return;
    try {
      const res = await fetch(`/api/quadros/${quadro.id}/convidados`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
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
      toast.success(`Convidado criado: ${result.nome}`);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      await navigator.clipboard.writeText(`${baseUrl}/q/${result.token}`);
      toast.success("Link copiado!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
    }
  };

  const criarConvidadosBulk = async (nomes: string[]) => {
    if (nomes.length === 0) return;
    try {
      const res = await fetch(`/api/quadros/${quadro.id}/convidados`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomes }),
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
      toast.success(
        `${criados.length} ${criados.length === 1 ? "convidado criado" : "convidados criados"}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
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
      <div className="w-full pb-16 py-5 sm:py-7">
        {/* Cabeçalho enxuto, na mesma linha: nome do quadro, as duas páginas e
            os botões. A coluna de 340px que existia à direita foi pra dentro do
            botão "Convidados" — era ela que espremia o Kanban pra 3 colunas. */}
        <header className="flex items-center gap-x-4 gap-y-2 flex-wrap pb-4 mb-5 border-b border-[color:var(--border)]">
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
              className="font-display text-[22px] sm:text-[24px] border-b-2 border-[color:var(--foreground)] bg-transparent outline-none text-[color:var(--foreground)]"
            />
          ) : (
            <h1
              onClick={() => setEditingName(true)}
              title="Clique pra editar"
              className="font-display text-[22px] sm:text-[24px] cursor-pointer hover:opacity-70 transition min-w-0 truncate text-[color:var(--foreground)]"
            >
              {quadro.nome}
            </h1>
          )}

          <QuadroAbas
            pagina={pagina}
            setPagina={setPagina}
            quantasTarefas={tarefas.length}
            quantasIdeias={quantasIdeias}
          />

          {/* A descrição continua editável, mas só ocupa espaço quando existe:
              o "Adicione uma descrição…" antigo comia uma linha inteira à toa. */}
          <QuadroDescricao
            valor={quadro.descricao}
            onSalvar={(d) => handleUpdateQuadro({ descricao: d })}
          />

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-1.5 text-[12.5px] font-medium text-[color:var(--muted-strong)] hover:border-[color:var(--muted)] hover:text-[color:var(--foreground)] transition whitespace-nowrap"
            >
              Adicionar existentes
            </button>
            <QuadroPainel
              convidados={convidados}
              onCreate={criarConvidado}
              onCreateBulk={criarConvidadosBulk}
              onRevoke={handleRevokeConvidado}
              atividade={atividade}
            />
          </div>
        </header>

        {pagina === "ideias" ? (
          <QuadroIdeias api={apiIdeias} />
        ) : (
          <TaskBoardView
            quadroId={quadro.id}
            tarefas={tarefas}
            onRemoveFromBoard={removerDoQuadro}
            vistaPadrao={vista}
            onMudarVistaPadrao={mudarVista}
          />
        )}
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

"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  GuestTaskProvider,
  useGuestTasks,
  useTaskMutations,
} from "@/lib/task-mutations";
import type { AcessoConvidado } from "@/lib/quadros";
import { TaskBoardView } from "./task-board-view";
import { PlanoTimeline } from "./plano-timeline";
import { CaptureComposer } from "./capture-composer";
import { ConvidadosManager } from "./convidados-manager";

interface GuestBoardProps {
  token: string;
  acesso: AcessoConvidado;
}

function GuestBoardContent({ token, acesso }: { token: string; acesso: AcessoConvidado }) {
  const { tarefas, loading, quadro, convidados, setQuadro, setConvidados } =
    useGuestTasks();
  const mut = useTaskMutations();
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);

  const vista = quadro?.vista_padrao ?? "lista";
  const nomeAtual = quadro?.nome ?? acesso.quadroNome;
  const descAtual = quadro?.descricao ?? null;
  const quadroId = quadro?.id ?? acesso.quadroId;

  const patchQuadro = async (updates: Record<string, unknown>) => {
    const res = await fetch(`/api/q/${token}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Erro ao atualizar o quadro");
    return res.json();
  };

  const mudarVista = async (nova: "lista" | "timeline") => {
    if (nova === vista) return;
    const prev = quadro;
    setQuadro((q) => (q ? { ...q, vista_padrao: nova } : q));
    try {
      await patchQuadro({ vista_padrao: nova });
    } catch (e) {
      setQuadro(prev);
      toast.error(e instanceof Error ? e.message : "Erro ao mudar a visão");
    }
  };

  const salvarNome = async (novo: string) => {
    setEditingName(false);
    const n = novo.trim();
    if (!n || n === nomeAtual) return;
    const prev = quadro;
    setQuadro((q) => (q ? { ...q, nome: n } : q));
    try {
      await patchQuadro({ nome: n });
      toast.success("Quadro atualizado");
    } catch (e) {
      setQuadro(prev);
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    }
  };

  const salvarDescricao = async (novo: string) => {
    setEditingDesc(false);
    const d = novo.trim() || null;
    if (d === descAtual) return;
    const prev = quadro;
    setQuadro((q) => (q ? { ...q, descricao: d } : q));
    try {
      await patchQuadro({ descricao: d });
    } catch (e) {
      setQuadro(prev);
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    }
  };

  const criarConvidado = async (nome: string) => {
    try {
      const res = await fetch(`/api/q/${token}/convidados`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      if (!res.ok) throw new Error("Erro ao criar convidado");
      const c = await res.json();
      setConvidados((p) => [
        { id: c.id, nome: c.nome, token: c.token, created_at: new Date().toISOString(), last_seen_at: null },
        ...p,
      ]);
      await navigator.clipboard.writeText(`${window.location.origin}/q/${c.token}`);
      toast.success(`Convidado criado: ${c.nome} — link copiado`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar convidado");
    }
  };

  const criarConvidadosBulk = async (nomes: string[]) => {
    try {
      const res = await fetch(`/api/q/${token}/convidados`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomes }),
      });
      if (!res.ok) throw new Error("Erro ao criar convidados");
      const { convidados: criados } = await res.json();
      setConvidados((p) => [
        ...criados.map((c: { id: string; nome: string; token: string }) => ({
          id: c.id,
          nome: c.nome,
          token: c.token,
          created_at: new Date().toISOString(),
          last_seen_at: null,
        })),
        ...p,
      ]);
      toast.success(`${criados.length} ${criados.length === 1 ? "convidado criado" : "convidados criados"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar convidados");
    }
  };

  const revogarConvidado = async (id: string) => {
    const prev = convidados;
    setConvidados((p) => p.filter((c) => c.id !== id));
    try {
      const res = await fetch(`/api/q/${token}/convidados/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao revogar");
      toast.success("Convidado revogado");
    } catch (e) {
      setConvidados(prev);
      toast.error(e instanceof Error ? e.message : "Erro ao revogar");
    }
  };

  const toggleBtn = (v: "lista" | "timeline", label: string) => (
    <button
      type="button"
      onClick={() => mudarVista(v)}
      className={`px-3 py-1 rounded-full transition ${
        vista === v
          ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
          : "text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-[color:var(--background)]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Cabeçalho editável */}
        <header className="mb-8 pb-6 border-b border-[color:var(--border)] space-y-2">
          {editingName ? (
            <input
              type="text"
              defaultValue={nomeAtual}
              autoFocus
              onBlur={(e) => salvarNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvarNome((e.target as HTMLInputElement).value);
              }}
              className="font-display text-3xl sm:text-4xl border-b-2 border-[color:var(--accent)] bg-transparent outline-none text-[color:var(--foreground)]"
            />
          ) : (
            <h1
              onClick={() => setEditingName(true)}
              className="font-display text-3xl sm:text-4xl font-light cursor-pointer hover:opacity-60 transition-opacity text-[color:var(--foreground)]"
              title="Clique pra editar"
            >
              {nomeAtual}
            </h1>
          )}

          {editingDesc ? (
            <textarea
              defaultValue={descAtual || ""}
              autoFocus
              rows={2}
              onBlur={(e) => salvarDescricao(e.target.value)}
              className="w-full max-w-2xl border border-[color:var(--border)] rounded-lg p-2 text-sm bg-[color:var(--card)] text-[color:var(--foreground)]"
            />
          ) : (
            <p
              onClick={() => setEditingDesc(true)}
              className="text-sm text-[color:var(--muted-strong)] cursor-pointer hover:opacity-60 transition-opacity"
              title="Clique pra editar"
            >
              {descAtual || "Adicione uma descrição..."}
            </p>
          )}

          <p className="text-sm text-[color:var(--muted-strong)] pt-1">
            Você está como{" "}
            <span className="font-semibold text-[color:var(--calm)]">
              {acesso.convidadoNome}
            </span>
          </p>
        </header>

        {/* Criar nova tarefa */}
        <div className="mb-8">
          <CaptureComposer onOpenFull={() => {}} />
        </div>

        {/* Tarefas: título + toggle de visão */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
            Tarefas <span className="text-[color:var(--muted)] text-base">{tarefas.length}</span>
          </h3>
          <div className="inline-flex rounded-full border border-[color:var(--border)] p-0.5 text-[12px] font-medium">
            {toggleBtn("lista", "Lista")}
            {toggleBtn("timeline", "Linha do tempo")}
          </div>
        </div>

        <main className="mb-12">
          {loading ? (
            <div className="flex justify-center py-16">
              <p className="text-[color:var(--muted)]">Carregando tarefas…</p>
            </div>
          ) : vista === "timeline" ? (
            <PlanoTimeline tarefas={tarefas} quadroId={quadroId} showManageButton={false} />
          ) : (
            <TaskBoardView tarefas={tarefas} onRemoveFromBoard={(id) => mut.remove(id)} />
          )}
        </main>

        {/* Convidados */}
        <div className="max-w-2xl border-t border-[color:var(--border)] pt-8">
          <ConvidadosManager
            convidados={convidados}
            onCreate={criarConvidado}
            onCreateBulk={criarConvidadosBulk}
            onRevoke={revogarConvidado}
          />
        </div>

        <footer className="mt-16 pt-8 border-t border-[color:var(--border)] text-center">
          <p className="text-xs text-[color:var(--muted)]">
            Quadro compartilhado — acesso seguro por link
          </p>
        </footer>
      </div>
    </div>
  );
}

export function GuestBoard({ token, acesso }: GuestBoardProps) {
  return (
    <GuestTaskProvider token={token}>
      <GuestBoardContent token={token} acesso={acesso} />
    </GuestTaskProvider>
  );
}

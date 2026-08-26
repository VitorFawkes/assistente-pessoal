"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GuestTaskProvider, useGuestTasks } from "@/lib/task-mutations";
import type { AcessoConvidado } from "@/lib/quadros";
import { TaskBoardView } from "./task-board-view";
import { QuadroAbas } from "./quadro-abas";
import { QuadroIdeias } from "./quadro-ideias";
import { ideiasDoConvidado } from "@/lib/ideias-api";
import { QuadroPainel } from "./quadro-painel";
import { QuadroDescricao } from "./quadro-descricao";
import { corDaPessoa, iniciais } from "@/lib/quadro-v2";
import { cn } from "@/lib/utils";

interface GuestBoardProps {
  token: string;
  acesso: AcessoConvidado;
}

function GuestBoardContent({ token, acesso }: { token: string; acesso: AcessoConvidado }) {
  const { tarefas, loading, quadro, convidados, setQuadro, setConvidados } =
    useGuestTasks();
  const [editandoNome, setEditandoNome] = useState(false);

  const [pagina, setPagina] = useState<"tarefas" | "ideias">("tarefas");
  const [quantasIdeias, setQuantasIdeias] = useState(0);
  const apiIdeias = useMemo(
    () => ideiasDoConvidado(token, () => window.location.reload()),
    [token],
  );
  useEffect(() => {
    let vivo = true;
    void apiIdeias.listar().then((l) => { if (vivo) setQuantasIdeias(l.length); }).catch(() => {});
    return () => { vivo = false; };
  }, [apiIdeias, pagina]);

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
    setEditandoNome(false);
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

  const salvarDescricao = async (nova: string | null) => {
    const prev = quadro;
    setQuadro((q) => (q ? { ...q, descricao: nova } : q));
    try {
      await patchQuadro({ descricao: nova });
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

  return (
    <div className="py-5 sm:py-7">
      {/* Cabeçalho enxuto: nome do quadro, as duas páginas e quem você é.
          O título gigante de antes empurrava as tarefas pra fora da tela. */}
      <header className="flex items-center gap-4 flex-wrap pb-4 mb-5 border-b border-[color:var(--border)]">
        {editandoNome ? (
          <input
            defaultValue={nomeAtual}
            autoFocus
            onBlur={(e) => salvarNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditandoNome(false);
            }}
            className="font-display text-[22px] border-b-2 border-[color:var(--foreground)] bg-transparent outline-none"
          />
        ) : (
          <h1
            onClick={() => setEditandoNome(true)}
            title="Clique pra editar"
            className="font-display text-[22px] sm:text-[24px] cursor-pointer hover:opacity-70 transition min-w-0 truncate"
          >
            {nomeAtual}
          </h1>
        )}

        <QuadroAbas
          pagina={pagina}
          setPagina={setPagina}
          quantasTarefas={tarefas.length}
          quantasIdeias={quantasIdeias}
        />

        <QuadroDescricao valor={descAtual} onSalvar={(d) => void salvarDescricao(d)} />

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--accent)] pl-1 pr-3 py-1 text-[12.5px] font-semibold text-[color:var(--muted-strong)]",
              corDaPessoa(acesso.convidadoNome),
            )}
          >
            <span className="q-ini">{iniciais(acesso.convidadoNome)}</span>
            Você está como {acesso.convidadoNome}
            <small className="font-semibold text-[color:var(--muted)]">· pode editar tudo</small>
          </span>
          <QuadroPainel
            convidados={convidados}
            onCreate={criarConvidado}
            onCreateBulk={criarConvidadosBulk}
            onRevoke={revogarConvidado}
          />
        </div>
      </header>

      <main className="mb-10">
        {pagina === "ideias" ? (
          <QuadroIdeias api={apiIdeias} />
        ) : loading ? (
          <div className="flex justify-center py-16">
            <p className="text-[color:var(--muted)]">Carregando tarefas…</p>
          </div>
        ) : (
          <TaskBoardView
            tarefas={tarefas}
            quadroId={quadroId}
            vistaPadrao={vista}
            onMudarVistaPadrao={mudarVista}
          />
        )}
      </main>

      <footer className="mt-12 pt-6 border-t border-[color:var(--border)] text-center">
        <p className="text-xs text-[color:var(--muted)]">
          Clique em qualquer texto e escreva: salva sozinho, sem botão de editar. Em
          &ldquo;Ver por&rdquo; você escolhe como a página se organiza. Todo mundo que entra
          pelo link pode criar, mudar, anexar e excluir tarefa.
        </p>
      </footer>
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

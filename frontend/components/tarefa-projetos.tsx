"use client";

// Equipe: em quais projetos a tarefa está, pôr em outro (ou num novo) e tirar.
// Fica dentro da tarefa aberta, em Pendências e na reunião.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LayoutGrid, Plus, X } from "lucide-react";
import type { Tarefa } from "@/lib/queries";

type ProjetoMin = { id: string; nome: string };

export function TarefaProjetos({ tarefa }: { tarefa: Tarefa }) {
  const router = useRouter();
  const noProjeto = tarefa.projetos ?? [];
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<ProjetoMin[] | null>(null);
  const [novo, setNovo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function abrir() {
    setAberto(true);
    if (lista) return;
    try {
      const r = await fetch("/api/quadros");
      const d = (await r.json()) as { quadros?: ProjetoMin[] };
      setLista((d.quadros ?? []).map((q) => ({ id: q.id, nome: q.nome })));
    } catch {
      setLista([]);
    }
  }

  async function por(p: ProjetoMin) {
    setOcupado(true);
    try {
      const r = await fetch(`/api/quadros/${p.id}/tarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarefaIds: [tarefa.id] }),
      });
      const d = (await r.json().catch(() => ({}))) as { adicionadas?: number; error?: string };
      if (!r.ok || !d.adicionadas) throw new Error(d.error || "Não deu para pôr no projeto.");
      toast.success(`Está no projeto ${p.nome}`);
      setAberto(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para pôr no projeto.");
    } finally {
      setOcupado(false);
    }
  }

  async function criarEPor() {
    const nome = novo.trim();
    if (!nome) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/quadros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      if (!r.ok) throw new Error("Não deu para criar o projeto.");
      const q = (await r.json()) as ProjetoMin;
      setNovo("");
      await por({ id: q.id, nome: q.nome });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para criar o projeto.");
      setOcupado(false);
    }
  }

  async function tirar(p: ProjetoMin) {
    setOcupado(true);
    try {
      const r = await fetch(`/api/quadros/${p.id}/tarefas/${tarefa.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Não deu para tirar do projeto.");
      toast.success(`Saiu do projeto ${p.nome}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para tirar do projeto.");
    } finally {
      setOcupado(false);
    }
  }

  const ja = new Set(noProjeto.map((p) => p.id));
  const opcoes = (lista ?? []).filter((p) => !ja.has(p.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {noProjeto.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1 text-[12px] pl-2 pr-1 py-0.5 rounded-full border border-[color:var(--border)]"
          >
            <LayoutGrid size={11} className="text-[color:var(--muted)]" />
            <Link href={`/quadros/${p.id}`} className="hover:underline max-w-[180px] truncate">
              {p.nome}
            </Link>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => tirar(p)}
              aria-label={`Tirar do projeto ${p.nome}`}
              title="Tirar deste projeto (a tarefa continua)"
              className="p-0.5 text-[color:var(--muted)] hover:text-[color:var(--urgent)] disabled:opacity-50"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {!aberto && (
          <button
            type="button"
            onClick={abrir}
            className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full border border-dashed border-[color:var(--border)] text-[color:var(--muted-strong)] hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)] transition"
          >
            <Plus size={11} /> pôr num projeto
          </button>
        )}
      </div>

      {aberto && (
        <div className="rounded-lg border border-[color:var(--border)] p-2 space-y-2">
          {lista === null ? (
            <p className="text-[12px] text-[color:var(--muted)] px-1">Carregando…</p>
          ) : opcoes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {opcoes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={ocupado}
                  onClick={() => por(p)}
                  className="inline-flex items-center gap-1 text-[12.5px] px-2.5 py-1 rounded-full border border-[color:var(--border)] hover:bg-[color:var(--accent)] transition disabled:opacity-50"
                >
                  <LayoutGrid size={11} /> {p.nome}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-[color:var(--muted)] px-1">
              {noProjeto.length ? "Já está em todos os seus projetos." : "Você ainda não tem projeto."}
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void criarEPor();
                }
                if (e.key === "Escape") setAberto(false);
              }}
              placeholder="ou crie um projeto novo + Enter"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md border border-[color:var(--border)] bg-transparent text-[13px] outline-none focus:border-[color:var(--muted)]"
            />
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            >
              fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Calendar } from "lucide-react";
import { cn, type Prioridade } from "@/lib/utils";
import { fimDoDiaBR, hojeBR, maisDiasBR, paraCampoBR, proximoDiaDaSemanaBR } from "@/lib/data-br";
import type { Acao } from "./task-row";

type Props = {
  onClose: () => void;
};

const PRIORIDADES: Prioridade[] = ["baixa", "media", "alta", "urgente"];
const ACOES: { value: Acao; label: string; hint: string }[] = [
  { value: "executar", label: "executar", hint: "eu faço o trabalho" },
  { value: "cobrar", label: "cobrar", hint: "outro faz, eu cobro / acompanho" },
  { value: "aguardar", label: "aguardar", hint: "outro faz, não preciso cobrar" },
];

const toDateInput = paraCampoBR;

// Prazo = fim do dia EM BRASÍLIA (ver lib/data-br.ts).
const dateInputToIso = fimDoDiaBR;

export function TaskCreateModal({ onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [owner, setOwner] = useState("");
  const [acao, setAcao] = useState<Acao>("executar");
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade>("media");
  const [frenteId, setFrenteId] = useState<string | null>(null);
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);
  const [pessoas, setPessoas] = useState<{ nome: string; principal: boolean }[]>(
    [],
  );
  const [novaPessoa, setNovaPessoa] = useState("");

  useEffect(() => {
    fetch("/api/frentes")
      .then((r) => r.json())
      .then((d: { frentes?: { id: string; nome: string }[] }) => {
        setFrentes(d.frentes ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  function setQuickPrazo(when: "hoje" | "amanha" | "sexta" | "proxsemana") {
    setPrazo(
      when === "hoje" ? hojeBR()
      : when === "amanha" ? maisDiasBR(1)
      : when === "sexta" ? proximoDiaDaSemanaBR(5)
      : proximoDiaDaSemanaBR(1),
    );
  }

  async function handleCreate() {
    setError(null);
    if (!titulo.trim()) {
      setError("título não pode ficar vazio");
      return;
    }
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {
          titulo: titulo.trim(),
          descricao: descricao.trim() || null,
          owner: owner.trim() || "vitor",
          acao,
          prazo: dateInputToIso(prazo),
          prioridade,
          frente_id: frenteId,
          pessoas,
        };
        const r = await fetch("/api/tarefas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `erro ${r.status}`);
          return;
        }
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-[color:var(--card)] border border-[color:var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Nova tarefa</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Título
            </label>
            <input
              type="text"
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="O que precisa ser feito?"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate();
              }}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Descrição
            </label>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              placeholder="Detalhes (opcional)"
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Ação
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ACOES.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAcao(a.value)}
                  title={a.hint}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-full border transition",
                    acao === a.value
                      ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)] font-semibold"
                      : "border-[color:var(--border)] text-[color:var(--muted-strong)] hover:border-[color:var(--muted)]",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[color:var(--muted)] mt-1.5">
              {ACOES.find((a) => a.value === acao)?.hint}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
                Responsável
              </label>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="vitor"
                className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
                Prioridade
              </label>
              <select
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value as Prioridade)}
                className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              <Calendar size={12} className="inline mr-1 -mt-0.5" />
              Prazo
            </label>
            <input
              type="date"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                { k: "hoje", label: "Hoje" },
                { k: "amanha", label: "Amanhã" },
                { k: "sexta", label: "Sexta" },
                { k: "proxsemana", label: "Próx semana" },
              ].map((opt) => (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() =>
                    setQuickPrazo(
                      opt.k as "hoje" | "amanha" | "sexta" | "proxsemana",
                    )
                  }
                  className="text-xs px-2 py-1 rounded border border-[color:var(--border)] hover:bg-[color:var(--accent)] transition"
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPrazo("")}
                className="text-xs px-2 py-1 rounded border border-dashed border-[color:var(--border)] hover:bg-[color:var(--accent)] transition text-[color:var(--muted)]"
              >
                limpar
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Área
            </label>
            <select
              value={frenteId ?? ""}
              onChange={(e) => setFrenteId(e.target.value || null)}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            >
              <option value="">— sem área —</option>
              {frentes.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Pessoas envolvidas
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {pessoas.map((p, i) => (
                <span
                  key={`${p.nome}-${i}`}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-[color:var(--border)]"
                >
                  <button
                    type="button"
                    title={
                      p.principal
                        ? "Principal (agrupa por esta)"
                        : "Marcar como principal"
                    }
                    onClick={() =>
                      setPessoas((prev) =>
                        prev.map((x, j) => ({ ...x, principal: j === i })),
                      )
                    }
                    className={cn(
                      p.principal
                        ? "text-[color:var(--warm)]"
                        : "text-[color:var(--muted)]",
                    )}
                  >
                    {p.principal ? "★" : "☆"}
                  </button>
                  {p.nome}
                  <button
                    type="button"
                    onClick={() =>
                      setPessoas((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="text-[color:var(--muted)] hover:text-[color:var(--urgent)]"
                  >
                    ×
                  </button>
                </span>
              ))}
              {pessoas.length === 0 && (
                <span className="text-[11px] text-[color:var(--muted)]">
                  nenhuma — agrupa em &ldquo;Você&rdquo;
                </span>
              )}
            </div>
            <input
              type="text"
              value={novaPessoa}
              onChange={(e) => setNovaPessoa(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nome = novaPessoa.trim();
                  if (
                    nome &&
                    !pessoas.some(
                      (p) => p.nome.toLowerCase() === nome.toLowerCase(),
                    )
                  ) {
                    setPessoas((prev) => [
                      ...prev,
                      { nome, principal: prev.length === 0 },
                    ]);
                  }
                  setNovaPessoa("");
                }
              }}
              placeholder="adicionar pessoa + Enter"
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="text-xs px-3 py-1.5 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending}
              className={cn(
                "text-xs px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 disabled:opacity-50",
              )}
            >
              {isPending ? "Criando..." : "Criar tarefa"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

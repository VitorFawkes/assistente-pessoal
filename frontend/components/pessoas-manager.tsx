"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, Check, X, Plus, Music, ChevronRight, Search } from "lucide-react";

export type PessoaListItem = {
  id: string;
  nome: string;
  aliases: string[];
  is_vitor: boolean;
  notas: string | null;
  n_reunioes: number;
  sample_count: number;
};

export function PessoasManager({ initial }: { initial: PessoaListItem[] }) {
  const router = useRouter();
  const [pessoas, setPessoas] = useState<PessoaListItem[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [busca, setBusca] = useState("");

  // Com 200 pessoas na lista, achar alguém era rolar a tela no olho.
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return pessoas;
    return pessoas.filter((p) =>
      [p.nome, ...(p.aliases ?? []), p.notas ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [pessoas, busca]);

  const refresh = () => router.refresh();

  const handleCreate = async (nome: string, aliasesRaw: string, notas: string) => {
    setError(null);
    const aliases = aliasesRaw
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const res = await fetch("/api/pessoas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, aliases, notas: notas || null }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "falha ao criar");
      return false;
    }
    const created = await res.json();
    setPessoas((prev) =>
      [...prev, { ...created, n_reunioes: 0, sample_count: 0 }].sort((a, b) => {
        if (a.is_vitor !== b.is_vitor) return a.is_vitor ? -1 : 1;
        return a.nome.localeCompare(b.nome);
      }),
    );
    setCreating(false);
    startTransition(refresh);
    return true;
  };

  const handleSave = async (
    id: string,
    nome: string,
    aliasesRaw: string,
    notas: string,
  ) => {
    setError(null);
    const aliases = aliasesRaw
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const res = await fetch(`/api/pessoas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, aliases, notas: notas || null }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "falha ao salvar");
      return;
    }
    const updated = await res.json();
    setPessoas((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, ...updated, n_reunioes: p.n_reunioes, sample_count: p.sample_count }
          : p,
      ),
    );
    setEditingId(null);
    startTransition(refresh);
  };

  const handleDelete = async (id: string, nome: string) => {
    if (!confirm(`Deletar "${nome}"? Não dá pra desfazer.`)) return;
    setError(null);
    const res = await fetch(`/api/pessoas/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "falha ao deletar");
      return;
    }
    setPessoas((prev) => prev.filter((p) => p.id !== id));
    startTransition(refresh);
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[12px] text-[color:var(--urgent)] bg-[color:var(--urgent-bg)] px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {creating ? (
        <PessoaForm
          onSubmit={handleCreate}
          onCancel={() => {
            setCreating(false);
            setError(null);
          }}
          submitting={isPending}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="press-feedback inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:ring-1 hover:ring-[color:var(--foreground)]/30"
        >
          <Plus size={14} /> Nova pessoa
        </button>
      )}

      {pessoas.length > 8 && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-[color:var(--border)]">
          <Search size={14} className="text-[color:var(--muted)] shrink-0" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pessoa…"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none"
          />
          <span className="shrink-0 text-[11px] text-[color:var(--muted)] tabular-nums">
            {visiveis.length}/{pessoas.length}
          </span>
          {busca && (
            <button
              type="button"
              onClick={() => setBusca("")}
              aria-label="Limpar busca"
              className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {visiveis.length === 0 && (
          <p className="text-sm text-[color:var(--muted)] py-6 text-center">
            Ninguém com esse nome.
          </p>
        )}
        {visiveis.map((p) =>
          editingId === p.id ? (
            <PessoaForm
              key={p.id}
              initial={p}
              onSubmit={(nome, aliases, notas) => {
                handleSave(p.id, nome, aliases, notas);
                return Promise.resolve(true);
              }}
              onCancel={() => {
                setEditingId(null);
                setError(null);
              }}
              submitting={isPending}
            />
          ) : (
            <div
              key={p.id}
              className="paper-card rounded-2xl border border-[color:var(--border)] hover:border-[color:var(--muted)] transition"
            >
              <div className="flex items-stretch">
                <Link
                  href={`/pessoas/${p.id}`}
                  className="flex-1 min-w-0 p-4 sm:p-5 group"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-medium text-[color:var(--foreground)] group-hover:underline">
                      {p.nome}
                    </span>
                    {p.is_vitor && (
                      <span className="text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)]">
                        Você
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[12px] text-[color:var(--muted)]">
                      <Music size={11} /> {p.sample_count}
                      {" "}
                      {p.sample_count === 1 ? "amostra" : "amostras"}
                    </span>
                    {p.n_reunioes > 0 && (
                      <span className="text-[12px] text-[color:var(--muted)]">
                        · {p.n_reunioes}{" "}
                        {p.n_reunioes === 1 ? "reunião" : "reuniões"}
                      </span>
                    )}
                    <ChevronRight
                      size={14}
                      className="ml-auto text-[color:var(--muted)] group-hover:text-[color:var(--foreground)]"
                    />
                  </div>
                  {p.aliases.length > 0 && (
                    <p className="mt-1 text-[12px] text-[color:var(--muted)]">
                      também: {p.aliases.join(", ")}
                    </p>
                  )}
                  {p.notas && (
                    <p className="mt-2 text-[13px] text-[color:var(--muted-strong)]">
                      {p.notas}
                    </p>
                  )}
                </Link>
                <div className="shrink-0 flex items-center gap-1 pr-3">
                  <button
                    type="button"
                    onClick={() => setEditingId(p.id)}
                    className="p-1.5 rounded-full text-[color:var(--muted)] hover:bg-[color:var(--accent)] hover:text-[color:var(--foreground)]"
                    aria-label="editar"
                  >
                    <Pencil size={14} />
                  </button>
                  {!p.is_vitor && (
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id, p.nome)}
                      className="p-1.5 rounded-full text-[color:var(--muted)] hover:bg-[color:var(--urgent-bg)] hover:text-[color:var(--urgent)]"
                      aria-label="deletar"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function PessoaForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial?: { nome: string; aliases: string[]; notas: string | null };
  onSubmit: (nome: string, aliases: string, notas: string) => Promise<boolean>;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [nome, setNome] = useState(initial?.nome || "");
  const [aliases, setAliases] = useState(initial?.aliases.join(", ") || "");
  const [notas, setNotas] = useState(initial?.notas || "");

  return (
    <div className="paper-card rounded-2xl border border-[color:var(--foreground)]/30 p-4 sm:p-5 space-y-3">
      <input
        type="text"
        autoFocus
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome (ex: Ana)"
        className="w-full text-[15px] px-3 py-2 rounded-lg bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
        disabled={submitting}
      />
      <input
        type="text"
        value={aliases}
        onChange={(e) => setAliases(e.target.value)}
        placeholder="Apelidos separados por vírgula (opcional)"
        className="w-full text-[13px] px-3 py-2 rounded-lg bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)]"
        disabled={submitting}
      />
      <textarea
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        placeholder="Notas (opcional) — ex: 'gestora, fala de Mari e Kícia'"
        rows={2}
        className="w-full text-[13px] px-3 py-2 rounded-lg bg-[color:var(--card)] border border-[color:var(--border)] outline-none focus:border-[color:var(--foreground)] resize-y"
        disabled={submitting}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const n = nome.trim();
            if (!n) return;
            onSubmit(n, aliases, notas.trim());
          }}
          disabled={submitting || !nome.trim()}
          className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
        >
          <Check size={14} /> Salvar
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]"
        >
          <X size={14} /> Cancelar
        </button>
      </div>
    </div>
  );
}

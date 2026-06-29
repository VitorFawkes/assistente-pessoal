"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

/**
 * Criação de quadro (client). A página /quadros é Server Component; este
 * componente faz o POST /api/quadros e navega pro gerenciador do novo quadro.
 */
export function NovoQuadro({ autoOpen = false }: { autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [saving, setSaving] = useState(false);

  async function criar() {
    const n = nome.trim();
    if (!n) {
      toast.error("Dá um nome pro quadro");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/quadros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: n, descricao: descricao.trim() || undefined }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `erro ${res.status}`);
      }
      const quadro = (await res.json()) as { id: string };
      toast.success("Quadro criado");
      router.push(`/quadros/${quadro.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar quadro");
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press-feedback inline-flex items-center gap-1.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] px-4 py-2 text-sm font-medium hover:opacity-90 transition"
      >
        <Plus size={15} strokeWidth={2.5} /> Novo quadro
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4 space-y-3 max-w-md text-left">
      <input
        autoFocus
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") criar();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Nome do quadro (ex: Tarefas do João)"
        className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm outline-none focus:border-[color:var(--muted)]"
      />
      <input
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") criar();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Descrição (opcional)"
        className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm outline-none focus:border-[color:var(--muted)]"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={criar}
          disabled={saving}
          className="rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Criando…" : "Criar quadro"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          className="text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

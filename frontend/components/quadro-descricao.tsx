"use client";

// A descrição do quadro: some quando está vazia (vira só um "+ descrição"
// discreto) e vira campo ao clicar. Antes ela ocupava uma linha inteira
// escrito "Adicione uma descrição…", mesmo em quadro nenhum usar.
import { useState } from "react";

export function QuadroDescricao({
  valor,
  onSalvar,
}: {
  valor: string | null;
  onSalvar: (novo: string | null) => void;
}) {
  const [editando, setEditando] = useState(false);

  function salvar(texto: string) {
    setEditando(false);
    const d = texto.trim() || null;
    if (d !== (valor ?? null)) onSalvar(d);
  }

  if (editando) {
    return (
      <input
        autoFocus
        defaultValue={valor ?? ""}
        placeholder="do que é este quadro"
        aria-label="descrição do quadro"
        onBlur={(e) => salvar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditando(false);
        }}
        className="min-w-[220px] rounded-lg border border-[color:var(--muted-strong)] bg-[color:var(--card)] px-2.5 py-1 text-[13px] outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditando(true)}
      title="Clique pra editar"
      className="max-w-[380px] truncate rounded-lg px-2 py-1 text-[13px] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] transition"
    >
      {valor || <span className="text-[color:var(--muted)]">+ descrição</span>}
    </button>
  );
}

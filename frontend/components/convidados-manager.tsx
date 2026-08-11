"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { CopyLinkButton } from "./copy-link-button";

export type ConvidadoLite = {
  id: string;
  nome: string;
  token: string;
  created_at: string;
};

interface ConvidadosManagerProps {
  convidados: ConvidadoLite[];
  onCreate: (nome: string) => Promise<void>;
  onCreateBulk: (nomes: string[]) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
}

// Seção de convidados (lista + criar + colar vários + revogar + copiar link).
// Compartilhada entre o dono (QuadroManager) e o convidado (GuestBoard) — o pai
// injeta os callbacks que batem nos endpoints certos (/api/quadros ou /api/q).
export function ConvidadosManager({
  convidados,
  onCreate,
  onCreateBulk,
  onRevoke,
}: ConvidadosManagerProps) {
  const [novoNome, setNovoNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [criandoBulk, setCriandoBulk] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const bulkNomes = [
    ...new Set(
      bulkText
        .split("\n")
        .map((n) => n.trim())
        .filter((n) => n.length > 0),
    ),
  ];

  const handleCreate = async () => {
    if (!novoNome.trim()) return;
    setCriando(true);
    try {
      await onCreate(novoNome.trim());
      setNovoNome("");
    } finally {
      setCriando(false);
    }
  };

  const handleBulk = async () => {
    if (bulkNomes.length === 0) return;
    setCriandoBulk(true);
    try {
      await onCreateBulk(bulkNomes);
      setBulkText("");
      setBulkOpen(false);
    } finally {
      setCriandoBulk(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg sm:text-xl font-light text-[color:var(--foreground)]">
          Convidados
        </h3>
        {convidados.length >= 2 && (
          <CopyLinkButton
            link={convidados.map((c) => `${c.nome} — ${baseUrl}/q/${c.token}`).join("\n")}
            label="Copiar todos os links"
            variant="button"
          />
        )}
      </div>

      {/* Uma linha por convidado. Em cartões, 6 convidados ocupavam a tela
          inteira e o "Revogar" vermelho era o elemento mais forte da página —
          um botão de destruir gritando mais alto que o trabalho. */}
      <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] divide-y divide-[color:var(--border)]">
        {convidados.length === 0 ? (
          <p className="text-sm text-[color:var(--muted)] p-4">Nenhum convidado ainda.</p>
        ) : (
          convidados.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[color:var(--foreground)] truncate">
                  {c.nome}
                </p>
                <p className="text-[11px] text-[color:var(--muted)]">
                  convidado em {new Date(c.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <CopyLinkButton
                link={`${baseUrl}/q/${c.token}`}
                label="Copiar link"
                variant="button"
              />
              <button
                onClick={() => onRevoke(c.id)}
                title={`Tirar o acesso de ${c.nome}`}
                aria-label={`Tirar o acesso de ${c.nome}`}
                className="shrink-0 p-1.5 rounded-lg text-[color:var(--muted)] hover:text-[color:var(--urgent)] hover:bg-[color:var(--urgent-bg)] transition"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Nome do novo convidado..."
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          className="flex-1 rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm bg-[color:var(--card)] text-[color:var(--foreground)] focus:border-[color:var(--accent)] outline-none transition-colors"
        />
        <button
          onClick={handleCreate}
          disabled={criando || !novoNome.trim()}
          className="px-4 py-2 rounded-lg bg-[color:var(--calm)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
        >
          {criando ? "Criando..." : "Criar"}
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
              onClick={handleBulk}
              disabled={criandoBulk || bulkNomes.length === 0}
              className="px-4 py-2 rounded-lg bg-[color:var(--calm)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
            >
              {criandoBulk
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
  );
}

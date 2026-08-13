"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Refaz resumo + tarefas da reunião. Apaga TODAS as tarefas dela antes de
 * recriar — por isso a confirmação em dois cliques (o segundo clique já é o
 * "tenho certeza", sem popup do navegador que ele fecha no automático).
 */
export function RegenerateButton({
  meetingId,
  tarefasCount,
}: {
  meetingId: string;
  tarefasCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 6000);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/regenerate`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.reprocessed === false) {
        setError("demorou mais que o esperado — recarregue em 1 minuto");
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-[11px] text-[color:var(--urgent)]">{error}</span>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title="Refaz o resumo e as tarefas a partir da transcrição atual"
        className="press-feedback inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:ring-1 hover:ring-[color:var(--foreground)]/30 disabled:opacity-60"
      >
        <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />
        {busy
          ? "refazendo…"
          : confirming
          ? tarefasCount > 0
            ? `apagar ${tarefasCount} e refazer?`
            : "confirmar?"
          : "refazer"}
      </button>
    </div>
  );
}

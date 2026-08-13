"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * Barra de confirmação dos trechos marcados pra apagar. Espelha a CutBar
 * (mesma posição e mesma anatomia) — a diferença é a segunda pergunta: depois
 * de apagar, refaz resumo e tarefas ou deixa como está?
 */
export function RemoveBar({
  meetingId,
  turnsMarcados,
  segmentIndices,
  onClear,
}: {
  meetingId: string;
  turnsMarcados: number;
  segmentIndices: number[];
  onClear: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<null | "só apagando" | "apagando e refazendo">(null);
  const [error, setError] = useState<string | null>(null);

  if (turnsMarcados === 0) return null;

  function apagar(regenerate: boolean) {
    setBusy(regenerate ? "apagando e refazendo" : "só apagando");
    setError(null);
    // Transition segura o "apagando…" até a transcrição voltar sem os trechos —
    // refazer resumo + tarefas leva de 30 a 90 segundos.
    startTransition(async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/segments/remove`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segment_indices: segmentIndices, regenerate }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            body.error === "WOULD_EMPTY_TRANSCRIPT"
              ? "isso apagaria a transcrição inteira — pra isso, delete a reunião"
              : body.error || `HTTP ${res.status}`,
          );
        }
        if (regenerate && body.reprocessed === false) {
          setError("o refazer demorou mais que o esperado — recarregue em 1 minuto");
        }
        router.refresh();
        setAsking(false);
        onClear();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="fixed bottom-4 inset-x-0 z-30 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto paper-card rounded-2xl border border-[color:var(--border)] shadow-xl px-4 py-3 flex items-center gap-3 max-w-lg w-full">
        <Trash2 size={16} className="text-[color:var(--urgent)] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium">
            {busy
              ? `${busy}…`
              : asking
              ? "apagar e refazer o resumo e as tarefas?"
              : `${turnsMarcados} ${turnsMarcados === 1 ? "trecho marcado" : "trechos marcados"} pra apagar`}
          </p>
          {error && <p className="text-[11px] text-[color:var(--urgent)] mt-0.5">{error}</p>}
        </div>

        {asking ? (
          <>
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={busy !== null}
              className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] px-2 disabled:opacity-50"
            >
              cancelar
            </button>
            <button
              type="button"
              onClick={() => apagar(false)}
              disabled={busy !== null}
              className="press-feedback text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)] disabled:opacity-50"
            >
              só apagar
            </button>
            <button
              type="button"
              onClick={() => apagar(true)}
              disabled={busy !== null}
              className="press-feedback text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
            >
              apagar e refazer
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onClear}
              disabled={busy !== null}
              className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] px-2 disabled:opacity-50"
            >
              limpar
            </button>
            <button
              type="button"
              onClick={() => setAsking(true)}
              disabled={busy !== null}
              className="press-feedback text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--urgent-bg)] text-[color:var(--urgent)] disabled:opacity-50"
            >
              apagar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

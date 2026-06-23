"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scissors } from "lucide-react";

export function CutBar({
  meetingId,
  cuts,
  onClear,
}: {
  meetingId: string;
  cuts: { at_seconds: number; label: string }[];
  onClear: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cuts.length === 0) return null;
  const nReunioes = cuts.length + 1;

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allow_short: true,
          cuts: cuts.map((c) => ({ at_seconds: c.at_seconds, title: c.label })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      onClear();
      // Pai vira archived_session → volta pra lista
      router.push("/reunioes");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-4 inset-x-0 z-30 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto paper-card rounded-2xl border border-[color:var(--border)] shadow-xl px-4 py-3 flex items-center gap-3 max-w-lg w-full">
        <Scissors size={16} className="text-[color:var(--muted-strong)] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium">
            {cuts.length} {cuts.length === 1 ? "corte marcado" : "cortes marcados"} → separar em{" "}
            {nReunioes} reuniões
          </p>
          {error && <p className="text-[11px] text-[color:var(--urgent)] mt-0.5">{error}</p>}
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] px-2 disabled:opacity-50"
        >
          limpar
        </button>
        <button
          type="button"
          onClick={commit}
          disabled={busy}
          className="press-feedback text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50"
        >
          {busy ? "separando…" : "separar"}
        </button>
      </div>
    </div>
  );
}

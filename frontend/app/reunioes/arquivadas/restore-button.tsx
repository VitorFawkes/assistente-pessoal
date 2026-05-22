"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Sparkles } from "lucide-react";

export function RestoreButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      startTransition(() => router.push(`/reunioes/${meetingId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={restore}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--calm-bg)] text-[color:var(--calm)] hover:opacity-80 disabled:opacity-50"
      >
        {busy ? <Sparkles size={12} className="animate-pulse" /> : <RotateCcw size={12} />}
        restaurar
      </button>
      {error && (
        <span className="text-[10px] text-[color:var(--urgent)]">{error}</span>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function DeleteMeetingButton({
  meetingId,
  redirectTo,
  label,
  className,
}: {
  meetingId: string;
  /** Se setado, navega pra cá depois de deletar (detalhe). Senão, só refresh (lista). */
  redirectTo?: string;
  /** Texto opcional ao lado do ícone. Sem texto = botão só de ícone. */
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: MouseEvent) => {
    // Na lista o botão fica por cima de um <Link> — evita navegar ao clicar.
    e.preventDefault();
    e.stopPropagation();
    if (busy || isPending) return;
    if (!confirm("Deletar esta reunião e tudo relacionado? Não dá pra desfazer.")) return;

    setBusy(true);
    const res = await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setBusy(false);
      alert(body.error || "falha ao deletar reunião");
      return;
    }
    if (redirectTo) {
      router.push(redirectTo);
    } else {
      startTransition(() => router.refresh());
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || isPending}
      title="Deletar reunião"
      aria-label="Deletar reunião"
      className={
        className ??
        "inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--urgent)] transition disabled:opacity-50"
      }
    >
      <Trash2 size={14} strokeWidth={1.75} />
      {label}
    </button>
  );
}

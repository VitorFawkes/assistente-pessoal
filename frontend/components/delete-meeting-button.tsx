"use client";

import { useEffect, useRef, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export function DeleteMeetingButton({
  meetingId,
  redirectTo,
  label,
  className,
  tarefasCount,
  comOutros = 0,
}: {
  meetingId: string;
  /** Se setado, navega pra cá depois de deletar (detalhe). Senão, só refresh (lista). */
  redirectTo?: string;
  /** Texto opcional ao lado do ícone. Sem texto = botão só de ícone. */
  label?: string;
  className?: string;
  /** Quantas tarefas somem junto — entra no aviso pra pessoa saber o tamanho do estrago. */
  tarefasCount?: number;
  /** Equipe: quantas dessas tarefas estão com outras pessoas (essas ficam com elas). */
  comOutros?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: globalThis.MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  // Na lista o botão fica por cima de um <Link> — evita navegar ao clicar.
  const parar = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const apagar = async (e: MouseEvent) => {
    parar(e);
    if (busy || isPending) return;
    setBusy(true);
    const res = await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setBusy(false);
      toast.error(body.error || "Não deu para apagar a reunião. Tente de novo.");
      return;
    }
    const fim = (await res.json().catch(() => ({}))) as { mantidas?: number };
    setAberto(false);
    toast.success(
      fim.mantidas
        ? `Reunião apagada. ${fim.mantidas === 1 ? "1 tarefa continua" : `${fim.mantidas} tarefas continuam`} com outras pessoas.`
        : "Reunião apagada",
    );
    if (redirectTo) {
      router.push(redirectTo);
    } else {
      setBusy(false);
      startTransition(() => router.refresh());
    }
  };

  const somem = tarefasCount === undefined ? undefined : Math.max(0, tarefasCount - comOutros);
  const tarefas =
    somem === undefined
      ? "as tarefas"
      : somem === 0
        ? null
        : somem === 1
          ? "a tarefa"
          : `as ${somem} tarefas`;

  return (
    <div className="relative shrink-0" ref={caixaRef}>
      <button
        type="button"
        onClick={(e) => {
          parar(e);
          setAberto((v) => !v);
        }}
        disabled={busy || isPending}
        title="Apagar reunião"
        aria-label="Apagar reunião"
        aria-expanded={aberto}
        className={
          className ??
          "inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--urgent)] transition disabled:opacity-50"
        }
      >
        <Trash2 size={14} strokeWidth={1.75} />
        {label}
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Apagar reunião"
          onClick={parar}
          className="absolute right-0 top-full mt-2 z-50 w-[min(300px,calc(100vw-2rem))] rounded-xl border border-[color:var(--border)] bg-[color:var(--background)] p-4 shadow-lg space-y-3 text-left cursor-default"
        >
          <p className="text-[14px] font-medium text-[color:var(--foreground)]">Apagar esta reunião?</p>
          <p className="text-[13px] leading-relaxed text-[color:var(--muted-strong)]">
            Some a gravação, a transcrição, o resumo
            {tarefas ? ` e ${tarefas} dela` : ""}. Não dá para desfazer.
          </p>
          {comOutros > 0 && (
            <p className="text-[12.5px] leading-relaxed text-[color:var(--muted-strong)]">
              {comOutros === 1
                ? "1 tarefa está com outra pessoa e continua com ela."
                : `${comOutros} tarefas estão com outras pessoas e continuam com elas.`}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={apagar}
              disabled={busy || isPending}
              className="flex-1 rounded-lg bg-[color:var(--urgent)] px-3 py-2 text-[13px] font-medium text-white hover:opacity-90 transition disabled:opacity-50"
            >
              {busy ? "Apagando…" : "Apagar tudo"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                parar(e);
                setAberto(false);
              }}
              disabled={busy}
              className="rounded-lg border border-[color:var(--border)] px-3 py-2 text-[13px] text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)] transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

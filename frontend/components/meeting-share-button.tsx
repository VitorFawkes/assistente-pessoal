"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Copy, Check, Link2Off, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Liga/desliga o link de leitura da reunião (/r/[token]).
 * Um link por reunião: quem recebe lê e baixa, não edita nada. Desligar mata
 * o link na hora — inclusive os que já foram enviados.
 */
export function MeetingShareButton({
  meetingId,
  tokenInicial,
}: {
  meetingId: string;
  tokenInicial: string | null;
}) {
  const [token, setToken] = useState<string | null>(tokenInicial);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const link = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/r/${token}` : "";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function criar() {
    setPending(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/link`, { method: "POST" });
      if (!res.ok) throw new Error();
      const { token: t } = await res.json();
      setToken(t);
      await copiar(`${window.location.origin}/r/${t}`);
      toast.success("Link criado e copiado");
    } catch {
      toast.error("Não deu pra criar o link");
    } finally {
      setPending(false);
    }
  }

  async function desligar() {
    setPending(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/link`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setToken(null);
      toast.success("Link desligado");
    } catch {
      toast.error("Não deu pra desligar o link");
    } finally {
      setPending(false);
    }
  }

  async function copiar(url = link) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard indisponível — ignora
    }
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`press-feedback inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full hover:ring-1 hover:ring-[color:var(--foreground)]/30 ${
          token
            ? "bg-[color:var(--calm-bg)] text-[color:var(--calm)]"
            : "bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
        }`}
        title="Mandar esta reunião pra alguém de fora"
      >
        <Share2 size={13} /> {token ? "link ligado" : "compartilhar"}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-30 paper-card rounded-xl border border-[color:var(--border)] shadow-lg p-3 w-[min(22rem,calc(100vw-2rem))] space-y-3">
          <p className="text-[10px] tracking-[0.16em] uppercase text-[color:var(--muted)]">
            link de leitura
          </p>

          {token ? (
            <>
              <p className="text-[12px] leading-snug text-[color:var(--muted-strong)]">
                Quem abrir vê o resumo, as ações e a transcrição, e pode baixar tudo. Não
                consegue mudar nada.
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 text-[12px] px-2.5 py-2 rounded-lg border border-[color:var(--border)] bg-transparent font-mono"
                />
                <button
                  type="button"
                  onClick={() => copiar()}
                  className="press-feedback shrink-0 inline-flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] hover:opacity-90"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <button
                type="button"
                onClick={desligar}
                disabled={pending}
                className="w-full flex items-center justify-center gap-2 text-[12px] px-3 py-2 rounded-lg border border-[color:var(--border)] text-[color:var(--urgent)] hover:bg-[color:var(--urgent-bg)] disabled:opacity-50"
              >
                {pending ? <Loader2 size={13} className="animate-spin" /> : <Link2Off size={13} />}
                Desligar o link
              </button>
              <p className="text-[11px] leading-snug text-[color:var(--muted)]">
                Desligar mata o link na hora, inclusive pra quem já recebeu.
              </p>
            </>
          ) : (
            <>
              <p className="text-[12px] leading-snug text-[color:var(--muted-strong)]">
                Hoje ninguém de fora consegue abrir esta reunião. O link deixa a pessoa ler o
                resumo, as ações e a transcrição, e baixar tudo, sem entrar na sua conta.
              </p>
              <button
                type="button"
                onClick={criar}
                disabled={pending}
                className="press-feedback w-full flex items-center justify-center gap-2 text-[13px] font-medium px-3 py-2.5 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] hover:opacity-90 disabled:opacity-50"
              >
                {pending ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
                Criar link e copiar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

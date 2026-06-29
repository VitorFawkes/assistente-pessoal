"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface CopyLinkButtonProps {
  link: string;
  label?: string;
  variant?: "icon" | "button";
}

/**
 * Botão para copiar link com feedback visual.
 * Exibe "Copiado!" por 2 segundos e volta ao estado original.
 */
export function CopyLinkButton({
  link,
  label = "Copiar link",
  variant = "button",
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copiado!");

      // Voltar ao estado original após 2 segundos
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Erro ao copiar link");
    }
  };

  if (variant === "icon") {
    return (
      <button
        onClick={handleCopy}
        className="p-1 rounded hover:bg-[color:var(--accent)] transition-colors"
        title={copied ? "Copiado!" : label}
      >
        {copied ? (
          <Check className="w-4 h-4 text-[color:var(--calm)]" />
        ) : (
          <Copy className="w-4 h-4 text-[color:var(--muted)]" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className={`px-3 py-1 rounded text-sm font-medium transition-all flex items-center gap-2 ${
        copied
          ? "bg-[color:var(--calm)] text-white"
          : "bg-[color:var(--border)] text-[color:var(--foreground)] hover:opacity-80"
      }`}
    >
      {copied ? (
        <>
          <Check className="w-4 h-4" />
          Copiado!
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" />
          {label}
        </>
      )}
    </button>
  );
}

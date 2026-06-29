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
        className="p-2 rounded-lg hover:bg-[color:var(--accent)] transition-all duration-200"
        title={copied ? "Copiado!" : label}
        aria-label={label}
      >
        {copied ? (
          <Check className="w-5 h-5 text-[color:var(--calm)]" strokeWidth={2} />
        ) : (
          <Copy className="w-5 h-5 text-[color:var(--muted)]" strokeWidth={1.5} />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border ${
        copied
          ? "bg-[color:var(--calm)] text-white border-[color:var(--calm)]"
          : "bg-transparent border-[color:var(--border)] text-[color:var(--foreground)] hover:border-[color:var(--calm)] hover:text-[color:var(--calm)]"
      }`}
    >
      {copied ? (
        <>
          <Check className="w-4 h-4" strokeWidth={2} />
          Copiado!
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" strokeWidth={1.5} />
          {label}
        </>
      )}
    </button>
  );
}

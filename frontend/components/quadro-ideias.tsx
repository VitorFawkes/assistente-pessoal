"use client";

// Página de Ideias do quadro: lugar pra jogar o que a gente está pensando,
// sem prazo e sem dono. Quando amadurece, vira tarefa com um clique.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ThumbsUp, Trash2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Ideia } from "@/lib/ideias";

type Api = {
  listar: () => Promise<Ideia[]>;
  guardar: (texto: string, tema: string) => Promise<Ideia[]>;
  apoiar: (id: string) => Promise<Ideia[]>;
  editar: (id: string, texto: string) => Promise<void>;
  excluir: (id: string) => Promise<void>;
  virarTarefa: (ideia: Ideia) => Promise<void>;
};

function CartaoIdeia({ ideia, api, recarregar }: { ideia: Ideia; api: Api; recarregar: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [virando, setVirando] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!confirmando) return;
    const t = setTimeout(() => setConfirmando(false), 3500);
    return () => clearTimeout(t);
  }, [confirmando]);

  return (
    <article className="paper-card rounded-xl border border-[color:var(--border)] p-3.5 flex gap-3 items-start">
      <button
        type="button"
        onClick={async () => { await api.apoiar(ideia.id); recarregar(); }}
        title={ideia.apoiei ? "tirar meu apoio" : "apoiar esta ideia"}
        className={cn(
          "shrink-0 flex flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1.5 transition",
          ideia.apoiei
            ? "border-[color:var(--calm)] bg-[color:var(--calm)]/10 text-[color:var(--calm)]"
            : "border-[color:var(--border)] text-[color:var(--muted)] hover:border-[color:var(--muted-strong)]",
        )}
      >
        <ThumbsUp size={13} />
        <span className="text-[11.5px] font-bold">{ideia.apoios}</span>
      </button>

      <div className="flex-1 min-w-0">
        <p
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onBlur={async (e) => {
            const novo = e.currentTarget.textContent?.trim() ?? "";
            if (novo && novo !== ideia.texto) {
              await api.editar(ideia.id, novo);
              toast.success("Ideia salva");
            } else if (!novo) {
              e.currentTarget.textContent = ideia.texto;
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.currentTarget.textContent = ideia.texto; e.currentTarget.blur(); }
          }}
          className="text-[14px] leading-relaxed outline-none rounded px-1 -mx-1 focus:ring-1 focus:ring-[color:var(--muted)]/40 cursor-text"
        >
          {ideia.texto}
        </p>
        <div className="mt-2 flex items-center gap-3 flex-wrap text-[12px] text-[color:var(--muted)]">
          <span className="font-medium text-[color:var(--muted-strong)]">{ideia.autor_nome}</span>
          <span>{new Date(ideia.criado_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
          {ideia.tema && (
            <span className="px-2 py-0.5 rounded bg-[color:var(--accent)] text-[color:var(--muted-strong)]">
              {ideia.tema}
            </span>
          )}
          {ideia.tarefa_id && (
            <span className="px-2 py-0.5 rounded-full bg-[color:var(--calm)]/12 text-[color:var(--calm)] font-semibold">
              virou tarefa ✓
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1.5">
        <button
          type="button"
          disabled={virando}
          onClick={async () => {
            setVirando(true);
            try { await api.virarTarefa(ideia); recarregar(); } finally { setVirando(false); }
          }}
          className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-lg border border-[color:var(--border)] hover:border-[color:var(--foreground)]/40 transition disabled:opacity-50"
        >
          {ideia.tarefa_id ? "Virar tarefa de novo" : "Virar tarefa"}
          <ArrowRight size={11} />
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!confirmando) { setConfirmando(true); return; }
            await api.excluir(ideia.id);
            recarregar();
          }}
          className={cn(
            "text-[11.5px] px-2 py-1 rounded-lg transition",
            confirmando
              ? "bg-[color:var(--urgent)] text-white font-semibold"
              : "text-[color:var(--muted)] hover:text-[color:var(--urgent)]",
          )}
        >
          {confirmando ? "excluir mesmo?" : <Trash2 size={13} />}
        </button>
      </div>
    </article>
  );
}

export function QuadroIdeias({ api }: { api: Api }) {
  const [ideias, setIdeias] = useState<Ideia[]>([]);
  const [texto, setTexto] = useState("");
  const [tema, setTema] = useState("");
  const [carregando, setCarregando] = useState(true);

  const recarregar = async () => {
    try { setIdeias(await api.listar()); } finally { setCarregando(false); }
  };

  useEffect(() => { void recarregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function guardar() {
    const t = texto.trim();
    if (!t) return;
    setTexto(""); setTema("");
    setIdeias(await api.guardar(t, tema.trim()));
    toast.success("Ideia guardada");
  }

  return (
    <div className="max-w-3xl">
      <p className="text-[13.5px] text-[color:var(--muted)] mb-4">
        Lugar pra jogar o que a gente está pensando, sem compromisso. Quando a ideia
        amadurecer, vira tarefa com um clique.
      </p>

      <div className="paper-card rounded-xl border border-[color:var(--border)] p-3 mb-5 focus-within:border-[color:var(--muted-strong)]">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void guardar(); }
          }}
          rows={2}
          placeholder="Qual é a ideia? Escreva do jeito que veio na cabeça…"
          className="w-full bg-transparent text-[14px] outline-none resize-y"
        />
        <div className="mt-2 pt-2 border-t border-dashed border-[color:var(--border)] flex items-center justify-between gap-2 flex-wrap">
          <input
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            placeholder="tema (opcional)"
            className="text-[12.5px] px-2 py-1 rounded border border-dashed border-[color:var(--border)] bg-transparent outline-none focus:border-[color:var(--muted-strong)] w-[180px]"
          />
          <button
            type="button"
            onClick={guardar}
            className="px-3.5 py-1.5 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] text-[13px] font-medium"
          >
            Guardar ideia
          </button>
        </div>
      </div>

      {carregando ? (
        <p className="text-[13px] text-[color:var(--muted)]">carregando…</p>
      ) : ideias.length === 0 ? (
        <p className="text-[13px] text-[color:var(--muted)]">
          Nenhuma ideia ainda. Escreva a primeira aí em cima.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {ideias.map((i) => (
            <CartaoIdeia key={i.id} ideia={i} api={api} recarregar={recarregar} />
          ))}
        </div>
      )}
    </div>
  );
}

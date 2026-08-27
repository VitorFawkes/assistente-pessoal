"use client";

// Mural de Ideias do quadro: o lugar onde qualquer um joga o que está pensando,
// sem prazo e sem dono. Quando a ideia amadurece, vira tarefa com um clique.
//
// Formato escolhido pelo Vitor (26/08/2026): mural de cartões, não planilha.
// A ideia é texto solto e precisa de espaço pra ser lida inteira.
//
// A ordem padrão é por apoio: o que o time mais quer sobe. Antes era só a
// ordem de chegada, e a página abria sem título, sem busca e sem contagem.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Search, ThumbsUp, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { corDaPessoa, iniciais } from "@/lib/quadro-v2";
import { haQuantoTempoBR } from "@/lib/data-br";
import type { Ideia } from "@/lib/ideias";

type Api = {
  listar: () => Promise<Ideia[]>;
  guardar: (texto: string, tema: string) => Promise<Ideia[]>;
  apoiar: (id: string) => Promise<Ideia[]>;
  editar: (id: string, texto: string) => Promise<void>;
  mudarTema: (id: string, tema: string) => Promise<void>;
  excluir: (id: string) => Promise<void>;
  virarTarefa: (ideia: Ideia) => Promise<void>;
};

type Ordem = "apoios" | "recentes" | "antigas" | "quem" | "tema";

const ORDENS: { valor: Ordem; rotulo: string }[] = [
  { valor: "apoios", rotulo: "Mais apoiadas" },
  { valor: "recentes", rotulo: "Mais recentes" },
  { valor: "antigas", rotulo: "Mais antigas" },
  { valor: "quem", rotulo: "Quem escreveu" },
  { valor: "tema", rotulo: "Tema" },
];


function CartaoIdeia({
  ideia,
  api,
  recarregar,
  temas,
}: {
  ideia: Ideia;
  api: Api;
  recarregar: () => void;
  temas: string[];
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [virando, setVirando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(ideia.texto);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listaId = `temas-ideia-${ideia.id}`;

  useEffect(() => {
    if (!confirmando) return;
    const t = setTimeout(() => setConfirmando(false), 3500);
    return () => clearTimeout(t);
  }, [confirmando]);

  useEffect(() => {
    if (editando) { ref.current?.focus(); ref.current?.select(); }
  }, [editando]);

  function abrir() { setTexto(ideia.texto); setEditando(true); }

  async function salvar() {
    setEditando(false);
    const t = texto.trim();
    if (!t || t === ideia.texto) return;
    await api.editar(ideia.id, t);
    recarregar();
  }

  return (
    <article className="paper-card rounded-2xl border border-[color:var(--border)] p-4 flex flex-col gap-3 hover:border-[color:var(--muted)] transition">
      <div className="flex gap-3.5 items-start">
        {/* Apoiar é a ação principal do mural: quem sobe é o que o time quer. */}
        <button
          type="button"
          onClick={async () => { await api.apoiar(ideia.id); recarregar(); }}
          aria-pressed={ideia.apoiei}
          title={ideia.apoiei ? "tirar meu apoio" : "apoiar esta ideia"}
          className={cn(
            "shrink-0 w-[52px] flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 transition",
            ideia.apoiei
              ? "border-[color:var(--done)] bg-[color:var(--done-bg)] text-[color:var(--done)]"
              : "border-[color:var(--border)] text-[color:var(--muted)] hover:border-[color:var(--muted-strong)] hover:text-[color:var(--foreground)]",
          )}
        >
          <ThumbsUp size={15} strokeWidth={2} />
          <span className="text-[15px] font-bold leading-none tabular-nums">{ideia.apoios}</span>
          <span className="text-[9.5px] uppercase tracking-wide leading-none opacity-70">
            {ideia.apoios === 1 ? "apoio" : "apoios"}
          </span>
        </button>

        <div className="flex-1 min-w-0">
          {editando ? (
            <textarea
              ref={ref}
              value={texto}
              rows={3}
              onChange={(e) => setTexto(e.target.value)}
              onBlur={salvar}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void salvar(); }
                if (e.key === "Escape") { setTexto(ideia.texto); setEditando(false); }
              }}
              className="w-full resize-y rounded-lg bg-[color:var(--card)] px-2 py-1.5 text-[14.5px] leading-relaxed outline-none ring-2 ring-[color:var(--foreground)]/25"
            />
          ) : (
            <p
              role="textbox"
              tabIndex={0}
              onClick={abrir}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); abrir(); } }}
              title="Clique e escreva"
              className="text-[14.5px] leading-relaxed cursor-text rounded-lg px-2 py-1.5 -mx-2 hover:bg-[color:var(--accent)] transition whitespace-pre-wrap"
            >
              {ideia.texto}
            </p>
          )}

          <div className="mt-2 flex items-center gap-2.5 flex-wrap text-[12px] text-[color:var(--muted)]">
            <span
              className={cn("inline-flex items-center gap-1.5 font-medium text-[color:var(--muted-strong)]", corDaPessoa(ideia.autor_nome))}
            >
              <span className="q-ini">{iniciais(ideia.autor_nome)}</span>
              {ideia.autor_nome}
            </span>
            <span>{haQuantoTempoBR(ideia.criado_em)}</span>
            <input
              list={listaId}
              defaultValue={ideia.tema ?? ""}
              key={ideia.tema ?? ""}
              placeholder="sem tema"
              aria-label="tema da ideia"
              onBlur={async (e) => {
                const novo = e.target.value.trim();
                if (novo === (ideia.tema ?? "")) return;
                await api.mudarTema(ideia.id, novo);
                recarregar();
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-[132px] rounded-md border border-dashed border-[color:var(--border)] bg-transparent px-2 py-0.5 text-[12px] font-medium text-[color:var(--muted-strong)] outline-none hover:bg-[color:var(--card)] focus:border-solid focus:border-[color:var(--muted-strong)]"
            />
            <datalist id={listaId}>
              {temas.map((t) => <option key={t} value={t} />)}
            </datalist>
            {ideia.tarefa_id && (
              <span className="px-2 py-0.5 rounded-full bg-[color:var(--done-bg)] text-[color:var(--done)] font-semibold">
                virou tarefa ✓
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-dashed border-[color:var(--border)]">
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
        <button
          type="button"
          disabled={virando}
          onClick={async () => {
            setVirando(true);
            try { await api.virarTarefa(ideia); recarregar(); } finally { setVirando(false); }
          }}
          className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-[color:var(--border)] hover:border-[color:var(--foreground)] hover:bg-[color:var(--accent)] transition disabled:opacity-50"
        >
          {ideia.tarefa_id ? "Virar tarefa de novo" : "Virar tarefa"}
          <ArrowRight size={12} />
        </button>
      </div>
    </article>
  );
}

export function QuadroIdeias({
  api,
  /** Avisa a aba "Ideias" quantas existem — sem isto o número ficava em 0
   *  mesmo depois de escrever a primeira. */
  onContagem,
}: {
  api: Api;
  onContagem?: (n: number) => void;
}) {
  const [ideias, setIdeias] = useState<Ideia[]>([]);
  const [texto, setTexto] = useState("");
  const [tema, setTema] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [ordem, setOrdem] = useState<Ordem>("apoios");
  const [busca, setBusca] = useState("");
  const [temaFiltro, setTemaFiltro] = useState("");

  const recarregar = async () => {
    try {
      const lista = await api.listar();
      setIdeias(lista);
      onContagem?.(lista.length);
    } finally {
      setCarregando(false);
    }
  };

  // Carrega uma vez ao abrir a página. `recarregar` é recriado a cada render;
  // pô-lo na lista faria a página buscar as ideias em laço.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void recarregar(); }, []);

  async function guardar() {
    const t = texto.trim();
    if (!t) return;
    setTexto(""); setTema("");
    const lista = await api.guardar(t, tema.trim());
    setIdeias(lista);
    onContagem?.(lista.length);
    toast.success("Ideia guardada");
  }

  const temas = useMemo(() => {
    const s = new Set<string>();
    ideias.forEach((i) => i.tema && s.add(i.tema));
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [ideias]);

  const aVista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const filtradas = ideias.filter(
      (i) =>
        (!temaFiltro || i.tema === temaFiltro) &&
        (!q || `${i.texto} ${i.autor_nome} ${i.tema ?? ""}`.toLowerCase().includes(q)),
    );
    return [...filtradas].sort((a, b) => {
      switch (ordem) {
        case "recentes": return b.criado_em.localeCompare(a.criado_em);
        case "antigas": return a.criado_em.localeCompare(b.criado_em);
        case "quem": return a.autor_nome.localeCompare(b.autor_nome, "pt-BR");
        case "tema": return (a.tema ?? "zzz").localeCompare(b.tema ?? "zzz", "pt-BR");
        default:
          return b.apoios - a.apoios || b.criado_em.localeCompare(a.criado_em);
      }
    });
  }, [ideias, ordem, busca, temaFiltro]);

  const viraramTarefa = ideias.filter((i) => i.tarefa_id).length;
  const filtrando = !!busca.trim() || !!temaFiltro;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="font-display text-[26px]">Ideias</h2>
        <span className="text-[13px] text-[color:var(--muted)]">
          {ideias.length === 0
            ? "nenhuma ainda"
            : `${ideias.length} ${ideias.length === 1 ? "ideia" : "ideias"}`}
          {viraramTarefa > 0 && ` · ${viraramTarefa} ${viraramTarefa === 1 ? "virou" : "viraram"} tarefa`}
        </span>
        <span className="text-[13px] text-[color:var(--muted)] ml-auto">
          Sem prazo e sem dono. Quando amadurecer, vira tarefa com um clique.
        </span>
      </div>

      <div className="paper-card rounded-2xl border border-[color:var(--border)] p-3.5 focus-within:border-[color:var(--muted-strong)] transition">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void guardar(); }
          }}
          rows={2}
          placeholder="Qual é a ideia? Escreva do jeito que veio na cabeça…"
          className="w-full bg-transparent text-[15px] leading-relaxed outline-none resize-y"
        />
        <div className="mt-2.5 pt-2.5 border-t border-dashed border-[color:var(--border)] flex items-center justify-between gap-2 flex-wrap">
          <input
            list="temas-novo"
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            placeholder="tema (opcional)"
            className="text-[12.5px] px-2 py-1 rounded-md border border-dashed border-[color:var(--border)] bg-transparent outline-none focus:border-solid focus:border-[color:var(--muted-strong)] w-[180px]"
          />
          <datalist id="temas-novo">
            {temas.map((t) => <option key={t} value={t} />)}
          </datalist>
          <button
            type="button"
            onClick={guardar}
            disabled={!texto.trim()}
            className="px-4 py-1.5 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] text-[13px] font-semibold disabled:opacity-40"
          >
            Guardar ideia
          </button>
        </div>
      </div>

      {ideias.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] px-2.5 py-1">
            <label className="text-[10.5px] uppercase tracking-wide text-[color:var(--muted)] font-semibold">
              Ordenar
            </label>
            <select
              value={ordem}
              onChange={(e) => setOrdem(e.target.value as Ordem)}
              className="bg-transparent text-[12.5px] font-medium outline-none cursor-pointer"
            >
              {ORDENS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </span>

          {temas.length > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1",
                temaFiltro
                  ? "border-[color:var(--foreground)]/35 bg-[color:var(--accent)]"
                  : "border-[color:var(--border)] bg-[color:var(--card)]",
              )}
            >
              <label className="text-[10.5px] uppercase tracking-wide text-[color:var(--muted)] font-semibold">
                Tema
              </label>
              <select
                value={temaFiltro}
                onChange={(e) => setTemaFiltro(e.target.value)}
                className="bg-transparent text-[12.5px] font-medium outline-none cursor-pointer max-w-[170px]"
              >
                <option value="">Tema: todos</option>
                {temas.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </span>
          )}

          <div className="relative flex-1 min-w-[180px] max-w-[320px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--muted)]" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar nas ideias…"
              className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] pl-8 pr-7 py-1.5 text-[13px] outline-none focus:border-[color:var(--muted-strong)]"
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca("")}
                aria-label="Limpar busca"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[color:var(--muted)] p-1"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <span className="text-[12px] text-[color:var(--muted)] ml-auto">
            {aVista.length} à vista
          </span>
        </div>
      )}

      {carregando ? (
        <p className="text-[13px] text-[color:var(--muted)]">carregando…</p>
      ) : ideias.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] py-12 text-center">
          <p className="font-display text-[20px] mb-1.5">Nenhuma ideia ainda.</p>
          <p className="text-[13px] text-[color:var(--muted)]">
            Escreva a primeira aí em cima. Não precisa estar pronta.
          </p>
        </div>
      ) : aVista.length === 0 ? (
        <div className="py-10 text-center text-[color:var(--muted)]">
          <p className="font-display text-[19px] text-[color:var(--foreground)] mb-1">
            Nada com esse filtro.
          </p>
          <button
            type="button"
            onClick={() => { setBusca(""); setTemaFiltro(""); }}
            className="text-[13px] font-semibold text-[color:var(--urgent)]"
          >
            Limpar
          </button>
        </div>
      ) : (
        <div className="grid gap-3 items-start [grid-template-columns:repeat(auto-fill,minmax(330px,1fr))]">
          {aVista.map((i) => (
            <CartaoIdeia key={i.id} ideia={i} api={api} recarregar={recarregar} temas={temas} />
          ))}
        </div>
      )}

      {filtrando && aVista.length > 0 && aVista.length < ideias.length && (
        <p className="text-[12px] text-[color:var(--muted)] text-center">
          {ideias.length - aVista.length} escondida
          {ideias.length - aVista.length > 1 ? "s" : ""} pelo filtro.
        </p>
      )}
    </div>
  );
}

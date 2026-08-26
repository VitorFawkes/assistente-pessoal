"use client";

// "+ Nova tarefa": um botão que abre uma linha igual à das tarefas, com dono,
// prazo, situação, resumo e tema. Escrevendo "sexta @Giordana #Google Ads" no
// título, os campos se preenchem sozinhos — é o que o rascunho prometia.
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTaskMutations } from "@/lib/task-mutations";
import { SITUACOES, corDaPessoa, iniciais } from "@/lib/quadro-v2";
import type { Tarefa } from "@/lib/queries";

const DIAS: Record<string, number> = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
};

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Lê data, dono e tema de dentro do título — e devolve o título já limpo. */
export function lerPedido(texto: string, pessoas: string[], temas: string[]) {
  const lido = { titulo: texto, dono: "", tema: "", data: "" };
  let resto = texto;

  const mTema = resto.match(/#([^#]+?)(?:\s{2,}|$)/);
  if (mTema) {
    const candidato = mTema[1].trim();
    lido.tema =
      temas.find((t) => semAcento(candidato).startsWith(semAcento(t))) ?? candidato;
    resto = resto.replace(mTema[0], " ").trim();
  }

  const mArroba = resto.match(/@([\wÀ-ÿ]+)/);
  if (mArroba) {
    const nome = mArroba[1];
    lido.dono =
      pessoas.find((p) => semAcento(p) === semAcento(nome)) ??
      nome.charAt(0).toUpperCase() + nome.slice(1);
    resto = resto.replace(mArroba[0], " ").trim();
  } else {
    const achou = pessoas.find((p) =>
      new RegExp(`\\b${semAcento(p)}\\b`).test(semAcento(resto)),
    );
    if (achou) lido.dono = achou;
  }

  const hoje = new Date();
  const t = semAcento(resto);
  let achado = "";
  let data: Date | null = null;

  const mData = t.match(/(\d{1,2})\/(\d{1,2})/);
  if (mData) {
    achado = mData[0];
    data = new Date(hoje.getFullYear(), Number(mData[2]) - 1, Number(mData[1]));
    if (data.getTime() < hoje.getTime() - 86_400_000 * 180) data.setFullYear(hoje.getFullYear() + 1);
  } else if (/\bhoje\b/.test(t)) {
    achado = "hoje";
    data = hoje;
  } else if (/\bamanha\b/.test(t)) {
    achado = "amanha";
    data = new Date(hoje.getTime() + 86_400_000);
  } else {
    for (const [nome, alvo] of Object.entries(DIAS)) {
      if (new RegExp(`\\b${nome}\\b`).test(t)) {
        achado = nome;
        const delta = (alvo - hoje.getDay() + 7) % 7 || 7;
        data = new Date(hoje.getTime() + delta * 86_400_000);
        break;
      }
    }
  }

  if (data && achado) {
    lido.data = iso(data);
    resto = resto
      .replace(new RegExp(`(pra|para|até|ate|em|de|do|da|no|na)?\\s*${achado.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), " ")
      .trim();
  }

  lido.titulo = resto.replace(/\s{2,}/g, " ").trim();
  if (lido.titulo) lido.titulo = lido.titulo.charAt(0).toUpperCase() + lido.titulo.slice(1);
  return lido;
}

export function QuadroCriar({
  tarefas,
  onCriada,
}: {
  tarefas: Tarefa[];
  onCriada?: () => void;
}) {
  const mut = useTaskMutations();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [dono, setDono] = useState("");
  const [prazo, setPrazo] = useState("");
  const [situacao, setSituacao] = useState<Tarefa["status"]>("aberta");
  const [resumo, setResumo] = useState("");
  const [tema, setTema] = useState("");
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);
  const campoRef = useRef<HTMLInputElement>(null);

  const pessoas = useMemo(() => {
    const s = new Set<string>();
    tarefas.forEach((t) => t.pessoas.forEach((p) => s.add(p.nome)));
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [tarefas]);

  useEffect(() => {
    if (!aberto) return;
    campoRef.current?.focus();
    if (!frentes.length) void mut.listFrentes().then(setFrentes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // Enquanto escreve, preenche os campos que ainda estão vazios.
  function aoEscrever(v: string) {
    setTitulo(v);
    const lido = lerPedido(v, pessoas, frentes.map((f) => f.nome));
    if (lido.dono && !dono) setDono(lido.dono);
    if (lido.data && !prazo) setPrazo(lido.data);
    if (lido.tema && !tema) setTema(lido.tema);
  }

  function limpar() {
    setTitulo(""); setDono(""); setPrazo(""); setSituacao("aberta");
    setResumo(""); setTema("");
  }

  async function criar() {
    const lido = lerPedido(titulo, pessoas, frentes.map((f) => f.nome));
    const nome = lido.titulo || titulo.trim();
    if (!nome || salvando) return;
    setSalvando(true);
    try {
      const donoFinal = dono || lido.dono;
      const prazoFinal = prazo || lido.data;
      const temaFinal = (tema || lido.tema).trim();

      let frenteId: string | null = null;
      if (temaFinal) {
        const lista = frentes.length ? frentes : await mut.listFrentes();
        const achou = lista.find((f) => f.nome.toLowerCase() === temaFinal.toLowerCase());
        const criada = achou ?? (await mut.createFrente?.(temaFinal)) ?? null;
        if (criada) {
          frenteId = criada.id;
          if (!achou) setFrentes((a) => [...a, criada]);
        }
      }

      const tarefa = await mut.create({
        titulo: nome,
        descricao: resumo.trim() || null,
        ...(donoFinal ? { owner: donoFinal, acao: "cobrar" as const } : {}),
        ...(prazoFinal
          ? { prazo: new Date(`${prazoFinal}T23:59:00`).toISOString() }
          : {}),
      });

      if (tarefa) {
        const ajustes: Record<string, unknown> = {};
        if (situacao !== "aberta") ajustes.status = situacao;
        if (frenteId) ajustes.frente_id = frenteId;
        if (donoFinal) ajustes.pessoas = [{ nome: donoFinal, principal: true }];
        if (Object.keys(ajustes).length) await mut.patch(tarefa.id, ajustes, { silent: true });
        limpar();
        campoRef.current?.focus();
        onCriada?.();
      }
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="w-full rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--card)] px-4 py-3 text-[14px] font-semibold text-[color:var(--muted-strong)] hover:border-solid hover:border-[color:var(--foreground)] hover:bg-[color:var(--accent)] transition"
      >
        + Nova tarefa
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--foreground)]/40 bg-[color:var(--card)] p-3.5 ring-2 ring-[color:var(--accent)]">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={campoRef}
          value={titulo}
          onChange={(e) => aoEscrever(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void criar(); }
            if (e.key === "Escape") { setAberto(false); limpar(); }
          }}
          placeholder="O que precisa ser feito?"
          aria-label="título da tarefa"
          className="flex-1 min-w-[220px] bg-transparent text-[14px] font-semibold outline-none"
        />

        <span className="inline-flex items-center gap-1.5">
          <span className={cn("q-ini", corDaPessoa(dono))} aria-hidden>
            {dono ? iniciais(dono) : "—"}
          </span>
          <input
            list="criar-pessoas"
            value={dono}
            onChange={(e) => setDono(e.target.value)}
            placeholder="sem dono"
            aria-label="dono"
            className="w-28 rounded-md border border-[color:var(--border)] bg-transparent px-2 py-1 text-[12.5px] outline-none focus:border-[color:var(--muted-strong)]"
          />
          <datalist id="criar-pessoas">
            {pessoas.map((p) => <option key={p} value={p} />)}
          </datalist>
        </span>

        <input
          type="date"
          value={prazo}
          onChange={(e) => setPrazo(e.target.value)}
          aria-label="vence em"
          className="rounded-md border border-[color:var(--border)] bg-transparent px-2 py-1 text-[12.5px]"
        />

        <select
          value={situacao}
          onChange={(e) => setSituacao(e.target.value as Tarefa["status"])}
          aria-label="situação"
          className="rounded-md border border-[color:var(--border)] bg-transparent px-2 py-1 text-[12.5px] font-medium"
        >
          {SITUACOES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
        </select>

        <button
          type="button"
          onClick={() => { setAberto(false); limpar(); }}
          title="cancelar"
          aria-label="cancelar"
          className="px-2 py-1 text-[color:var(--muted)] hover:text-[color:var(--urgent)]"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={resumo}
          onChange={(e) => setResumo(e.target.value)}
          placeholder="resumo em uma linha (opcional)"
          aria-label="resumo"
          className="flex-1 min-w-[200px] bg-transparent text-[12.5px] text-[color:var(--muted-strong)] outline-none"
        />
        <input
          list="criar-temas"
          value={tema}
          onChange={(e) => setTema(e.target.value)}
          placeholder="sem tema"
          aria-label="tema"
          className="w-[132px] rounded-md border border-dashed border-[color:var(--border)] bg-transparent px-2 py-0.5 text-[12px] font-medium outline-none focus:border-solid focus:border-[color:var(--muted-strong)]"
        />
        <datalist id="criar-temas">
          {frentes.map((f) => <option key={f.id} value={f.nome} />)}
        </datalist>
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-dashed border-[color:var(--border)] flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-[color:var(--muted)]">
          Dica: escreva <b className="text-[color:var(--muted-strong)]">sexta @Giordana #Google Ads</b>{" "}
          no título que eu preencho os campos sozinho.
        </span>
        <button
          type="button"
          onClick={() => void criar()}
          disabled={salvando || !titulo.trim()}
          className="rounded-lg bg-[color:var(--foreground)] px-4 py-1.5 text-[13px] font-semibold text-[color:var(--background)] disabled:opacity-50"
        >
          {salvando ? "Criando…" : "Criar tarefa"}
        </button>
      </div>
    </div>
  );
}

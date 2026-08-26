"use client";

// Barra de controles do quadro: visão, busca, atalhos de prazo, "Ver por",
// ordenação e os filtros de pessoa/tema/situação. O que sobrou de menos usado
// mora atrás de "Mais filtros" pra não poluir a tela.
import { useMemo } from "react";
import { Columns3, GanttChartSquare, Rows3, Search, SlidersHorizontal, Table2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SITUACOES,
  faixaDoPrazo,
  passa,
  type FaixaPrazo,
  type Filtros,
  type Ordenacao,
  type VerPor,
} from "@/lib/quadro-v2";
import type { Tarefa } from "@/lib/queries";

export type Visao = "lista" | "colunas" | "tabela" | "timeline";

// Um único lugar pra escolher o formato — antes havia dois seletores com
// "Lista" nos dois, e um deles gravava no quadro sem avisar.
// Cada formato tem desenho próprio: sem os ícones, "Linha do tempo" parecia
// legenda e o Vitor não achou o botão.
const VISOES: { valor: Visao; rotulo: string; Icone: typeof Rows3 }[] = [
  { valor: "lista", rotulo: "Lista", Icone: Rows3 },
  { valor: "colunas", rotulo: "Colunas", Icone: Columns3 },
  { valor: "tabela", rotulo: "Tabela", Icone: Table2 },
  { valor: "timeline", rotulo: "Linha do tempo", Icone: GanttChartSquare },
];

const ATALHOS: { chave: FaixaPrazo | "todas"; rotulo: string; tom?: "perigo" | "alerta" }[] = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "vencida", rotulo: "Atrasadas", tom: "perigo" },
  { chave: "hoje", rotulo: "Hoje", tom: "alerta" },
  { chave: "semana", rotulo: "Esta semana", tom: "alerta" },
  { chave: "depois", rotulo: "Depois" },
  { chave: "semprazo", rotulo: "Sem prazo" },
];

const ORDENS: { valor: Ordenacao; rotulo: string }[] = [
  { valor: "prazo", rotulo: "Data: mais antiga primeiro" },
  { valor: "prazo_desc", rotulo: "Data: mais nova primeiro" },
  { valor: "manual", rotulo: "Minha ordem (arrastando)" },
  { valor: "pessoa", rotulo: "Pessoa" },
  { valor: "tema", rotulo: "Tema" },
  { valor: "situacao", rotulo: "Situação" },
  { valor: "reuniao", rotulo: "Reunião de origem" },
  { valor: "titulo", rotulo: "Título (A a Z)" },
  { valor: "recentes", rotulo: "Criada recentemente" },
];

const VER_POR: { valor: VerPor; rotulo: string }[] = [
  { valor: "nada", rotulo: "Nada (lista corrida)" },
  { valor: "situacao", rotulo: "Situação" },
  { valor: "pessoa", rotulo: "Pessoa" },
  { valor: "prazo", rotulo: "Prazo" },
  { valor: "tema", rotulo: "Tema" },
];

function Campo({
  rotulo,
  valor,
  onChange,
  destaque,
  children,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  /** "Ver por" é o botão que mais muda a página — fica sempre em destaque. */
  destaque?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1",
        valor || destaque
          ? "border-[color:var(--foreground)]/35 bg-[color:var(--accent)]"
          : "border-[color:var(--border)] bg-[color:var(--card)]",
      )}
    >
      <label className="text-[10.5px] uppercase tracking-wide text-[color:var(--muted)] font-semibold">
        {rotulo}
      </label>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-[12.5px] font-medium outline-none cursor-pointer max-w-[190px]"
      >
        {children}
      </select>
    </span>
  );
}

export function QuadroControles({
  tarefas,
  visao,
  setVisao,
  filtros,
  setFiltros,
  verPor,
  setVerPor,
  ordenar,
  setOrdenar,
  maisAberto,
  setMaisAberto,
  visiveis,
}: {
  tarefas: Tarefa[];
  visao: Visao;
  setVisao: (v: Visao) => void;
  filtros: Filtros;
  setFiltros: (f: Filtros) => void;
  verPor: VerPor;
  setVerPor: (v: VerPor) => void;
  ordenar: Ordenacao;
  setOrdenar: (o: Ordenacao) => void;
  maisAberto: boolean;
  setMaisAberto: (v: boolean) => void;
  visiveis: number;
}) {
  const muda = (parcial: Partial<Filtros>) => setFiltros({ ...filtros, ...parcial });

  // Contagem de cada atalho de prazo já considerando os outros filtros.
  const contagens = useMemo(() => {
    const c: Record<string, number> = { todas: 0, vencida: 0, hoje: 0, semana: 0, depois: 0, semprazo: 0 };
    for (const t of tarefas) {
      if (!passa(t, filtros, new Date(), "prazo")) continue;
      c.todas++;
      const f = faixaDoPrazo(t);
      if (f in c) c[f]++;
    }
    return c;
  }, [tarefas, filtros]);

  const pessoas = useMemo(() => {
    const s = new Set<string>();
    tarefas.forEach((t) => t.pessoas.forEach((p) => s.add(p.nome)));
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [tarefas]);

  const temas = useMemo(() => {
    const s = new Set<string>();
    tarefas.forEach((t) => t.frente && s.add(t.frente));
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [tarefas]);

  const reunioes = useMemo(() => {
    const m = new Map<string, string>();
    tarefas.forEach((t) => {
      if (t.meeting_id) {
        m.set(t.meeting_id, (t.meeting_summary ?? "Reunião").slice(0, 42));
      }
    });
    return [...m.entries()];
  }, [tarefas]);

  const sujo =
    !!filtros.busca || filtros.prazo !== "todas" || !!filtros.pessoa || !!filtros.tema ||
    !!filtros.situacao || !!filtros.reuniao || !!filtros.anexos || !filtros.concluidas;

  const extras = [filtros.reuniao, filtros.anexos].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-2.5">
      {/* visão + busca + contagem */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="inline-flex flex-wrap rounded-xl border border-[color:var(--border)] bg-[color:var(--accent)]/50 p-1 gap-1 max-w-full">
          {VISOES.map((v) => {
            const ativa = visao === v.valor;
            const Icone = v.Icone;
            return (
              <button
                key={v.valor}
                type="button"
                onClick={() => setVisao(v.valor)}
                aria-pressed={ativa}
                title={`Ver como ${v.rotulo}`}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition whitespace-nowrap border",
                  ativa
                    ? "bg-[color:var(--card)] text-[color:var(--foreground)] border-[color:var(--muted-strong)] shadow-sm"
                    : "bg-[color:var(--card)]/60 text-[color:var(--muted-strong)] border-[color:var(--border)] hover:text-[color:var(--foreground)] hover:border-[color:var(--muted)]",
                )}
              >
                <Icone size={13} strokeWidth={2} />
                {v.rotulo}
              </button>
            );
          })}
        </div>

        <div className="relative flex-1 min-w-[190px] max-w-[340px]">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--muted)]"
          />
          <input
            value={filtros.busca}
            onChange={(e) => muda({ busca: e.target.value })}
            placeholder="Buscar tarefa, pessoa, tema…"
            className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] pl-8 pr-7 py-1.5 text-[13px] outline-none focus:border-[color:var(--muted-strong)]"
          />
          {filtros.busca && (
            <button
              type="button"
              onClick={() => muda({ busca: "" })}
              aria-label="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[color:var(--muted)] p-1"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <span className="text-[12px] text-[color:var(--muted)] ml-auto">
          {visiveis} {visiveis === 1 ? "tarefa à vista" : "tarefas à vista"}
        </span>
      </div>

      {/* atalhos de prazo */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {ATALHOS.map((a) => {
          const ativo = filtros.prazo === a.chave;
          return (
            <button
              key={a.chave}
              type="button"
              onClick={() => muda({ prazo: a.chave })}
              aria-pressed={ativo}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition",
                ativo
                  ? a.tom === "perigo"
                    ? "bg-[color:var(--urgent)] border-[color:var(--urgent)] text-white"
                    : a.tom === "alerta"
                    ? "bg-[color:var(--warm)] border-[color:var(--warm)] text-white"
                    : "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
                  : "border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--muted-strong)] hover:border-[color:var(--muted)]",
              )}
            >
              {a.rotulo}
              <span className={cn("text-[11px] font-bold", ativo ? "opacity-75" : "text-[color:var(--muted)]")}>
                {contagens[a.chave] ?? 0}
              </span>
            </button>
          );
        })}

        <span className="w-px h-5 bg-[color:var(--border)] mx-0.5" />

        <button
          type="button"
          onClick={() => muda({ concluidas: !filtros.concluidas })}
          aria-pressed={filtros.concluidas}
          className={cn(
            "rounded-full border px-3 py-1 text-[12px] font-medium transition",
            filtros.concluidas
              ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
              : "border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--muted-strong)]",
          )}
        >
          Mostrar concluídas
        </button>

        {sujo && (
          <button
            type="button"
            onClick={() =>
              setFiltros({
                busca: "", prazo: "todas", pessoa: "", tema: "",
                situacao: "", reuniao: "", anexos: "", concluidas: true,
              })
            }
            className="text-[12px] font-semibold text-[color:var(--urgent)] px-2 py-1"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* ver por, ordenar e os filtros principais */}
      <div className="flex items-center gap-2 flex-wrap">
        <Campo destaque rotulo="Ver por" valor={verPor === "nada" ? "" : verPor} onChange={(v) => setVerPor((v || "nada") as VerPor)}>
          {VER_POR.map((o) => (
            <option key={o.valor} value={o.valor === "nada" ? "" : o.valor}>
              {o.rotulo}
            </option>
          ))}
        </Campo>

        <Campo rotulo="Ordenar por" valor={ordenar} onChange={(v) => setOrdenar(v as Ordenacao)}>
          {ORDENS.map((o) => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
        </Campo>

        <Campo rotulo="Pessoa" valor={filtros.pessoa} onChange={(v) => muda({ pessoa: v })}>
          <option value="">Pessoa: todas</option>
          {pessoas.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="__sem__">Sem dono</option>
        </Campo>

        <Campo rotulo="Tema" valor={filtros.tema} onChange={(v) => muda({ tema: v })}>
          <option value="">Tema: todos</option>
          {temas.map((t) => <option key={t} value={t}>{t}</option>)}
        </Campo>

        <Campo rotulo="Situação" valor={filtros.situacao} onChange={(v) => muda({ situacao: v })}>
          <option value="">Situação: todas</option>
          {SITUACOES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
        </Campo>

        <button
          type="button"
          onClick={() => setMaisAberto(!maisAberto)}
          aria-pressed={maisAberto}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition",
            maisAberto || extras
              ? "bg-[color:var(--foreground)] border-[color:var(--foreground)] text-[color:var(--background)]"
              : "border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--muted-strong)]",
          )}
        >
          <SlidersHorizontal size={12} />
          Mais filtros
          {extras > 0 && <span className="text-[11px] font-bold opacity-80">{extras}</span>}
        </button>
      </div>

      {maisAberto && (
        <div className="flex items-center gap-2 flex-wrap">
          <Campo rotulo="Veio de" valor={filtros.reuniao} onChange={(v) => muda({ reuniao: v })}>
            <option value="">Veio de: tudo</option>
            {reunioes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            <option value="__mao__">Criada na mão</option>
          </Campo>
          <Campo rotulo="Arquivos" valor={filtros.anexos} onChange={(v) => muda({ anexos: v as "" | "com" | "sem" })}>
            <option value="">Arquivos: tanto faz</option>
            <option value="com">Só com arquivo</option>
            <option value="sem">Só sem arquivo</option>
          </Campo>
        </div>
      )}
    </div>
  );
}

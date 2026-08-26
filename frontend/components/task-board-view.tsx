"use client";

// Tela das tarefas dentro de um quadro.
// Quatro formatos (Lista, Colunas/Kanban, Tabela e Linha do tempo) sobre a
// MESMA lista, com "Ver por" mandando no agrupamento — a página não é presa à
// situação. Arrastar funciona pegando o cartão inteiro; soltar em outro grupo
// muda a situação (ou o dono, ou o tema, conforme o "Ver por").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuadroTarefa } from "./quadro-tarefa";
import { QuadroResumo } from "./quadro-resumo";
import { QuadroCriar } from "./quadro-criar";
import { PlanoTimeline } from "./plano-timeline";
import { QuadroControles, type Visao } from "./quadro-controles";
import { useTaskMutations } from "@/lib/task-mutations";
import {
  FILTROS_VAZIOS,
  agrupar,
  colunasKanban,
  comparar,
  donoDe,
  faixaDoPrazo,
  ORDENS_COLUNA,
  compararNaColuna,
  ordemPadraoDaColuna,
  passa,
  passaNaBuscaDaColuna,
  pessoasDoQuadro,
  type Filtros,
  type Grupo,
  type OrdemColuna,
  type Ordenacao,
  type VerPor,
} from "@/lib/quadro-v2";
import type { Tarefa } from "@/lib/queries";

type Arrasto = {
  id: string;
  origem: string;
  alvo: string | null;
  antesDe: string | null;
  x: number;
  y: number;
};

export function TaskBoardView({
  tarefas,
  onRemoveFromBoard,
  quadroId,
  vistaPadrao = "lista",
  onMudarVistaPadrao,
}: {
  tarefas: Tarefa[];
  /** Só o dono "remove do quadro" (desvincula sem apagar). */
  onRemoveFromBoard?: (id: string) => void;
  /** Necessário pra guardar a ordem que a pessoa montou arrastando. */
  quadroId?: string;
  /** Visão gravada no quadro: 'timeline' é o quadro aberto como plano. */
  vistaPadrao?: "lista" | "timeline";
  onMudarVistaPadrao?: (v: "lista" | "timeline") => void;
}) {
  const mut = useTaskMutations();
  const [visao, setVisao] = useState<Visao>(vistaPadrao === "timeline" ? "timeline" : "lista");
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [verPor, setVerPor] = useState<VerPor>("nada");
  const [ordenar, setOrdenar] = useState<Ordenacao>("prazo");
  const [maisAberto, setMaisAberto] = useState(false);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  // Cada coluna guarda a própria régua: como ordena e o que busca ali dentro.
  const [reguas, setReguas] = useState<Record<string, { ordem?: OrdemColuna; busca?: string }>>({});
  const arrastouRef = useRef(false);
  const criarRef = useRef<HTMLDivElement>(null);

  // "Linha do tempo" fica gravada no quadro (é o "transformar em plano");
  // Lista/Colunas/Tabela são escolha de quem está olhando agora.
  const trocarVisao = (nova: Visao) => {
    setVisao(nova);
    if (nova === "timeline" && vistaPadrao !== "timeline") onMudarVistaPadrao?.("timeline");
    if (nova !== "timeline" && vistaPadrao === "timeline") onMudarVistaPadrao?.("lista");
  };

  // Em Colunas o quadro vira Kanban: sem agrupamento escolhido, agrupa por situação.
  const modo: VerPor = visao === "colunas" && verPor === "nada" ? "situacao" : verPor;

  const visiveis = useMemo(
    () => tarefas.filter((t) => passa(t, filtros)).sort((a, b) => comparar(a, b, ordenar)),
    [tarefas, filtros, ordenar],
  );

  // Só quem já está no quadro entra no seletor de dono da linha.
  const nomesNoQuadro = useMemo(
    () => pessoasDoQuadro(tarefas).filter((p) => p.chave !== "__sem__").map((p) => p.nome),
    [tarefas],
  );

  const grupos: Grupo[] = useMemo(() => {
    const base =
      visao === "colunas" && modo === "situacao" ? colunasKanban(visiveis) : agrupar(visiveis, modo);
    // Fora de Colunas a régua por coluna não existe: a lista é a do quadro.
    if (visao !== "colunas") return base;
    return base.map((g) => {
      const r = reguas[g.chave] ?? {};
      const ordem = r.ordem ?? ordemPadraoDaColuna(g.chave);
      const dentro = g.tarefas.filter((t) => passaNaBuscaDaColuna(t, r.busca ?? ""));
      return { ...g, tarefas: [...dentro].sort((a, b) => compararNaColuna(a, b, ordem)) };
    });
  }, [visiveis, modo, visao, reguas]);

  // ─── arrastar ───────────────────────────────────────────────────────
  const aplicarSolta = useCallback(
    async (tarefa: Tarefa, grupoDestino: string, ordemNova: string[]) => {
      // muda o campo que o agrupamento representa
      if (modo === "situacao" && tarefa.status !== grupoDestino) {
        await mut.patch(tarefa.id, { status: grupoDestino as Tarefa["status"] }, { silent: true });
      } else if (modo === "pessoa") {
        const novo = grupoDestino === "__sem__" ? "" : grupoDestino;
        if ((donoDe(tarefa) ?? "") !== novo) {
          const pessoas = [
            ...(novo ? [{ nome: novo, principal: true }] : []),
            ...tarefa.pessoas.filter((p) => !p.principal && p.nome !== novo).map((p) => ({ nome: p.nome })),
          ];
          await mut.patch(tarefa.id, { pessoas, owner: novo || "vitor" }, { silent: true });
        }
      } else if (modo === "tema") {
        const atual = tarefa.frente ?? "";
        const alvo = grupoDestino === "__sem__" ? "" : grupoDestino;
        if (atual !== alvo) {
          if (!alvo) await mut.patch(tarefa.id, { frente_id: null }, { silent: true });
          else {
            const lista = await mut.listFrentes();
            const achou = lista.find((f) => f.nome === alvo);
            if (achou) await mut.patch(tarefa.id, { frente_id: achou.id }, { silent: true });
          }
        }
      }
      // guarda a ordem montada
      if (quadroId && ordemNova.length) {
        await mut.reorder(ordemNova, quadroId);
        if (ordenar !== "manual") {
          setOrdenar("manual");
          toast.info('Ordenação virou "Minha ordem" pra guardar o que você arrastou.');
        }
      }
    },
    [modo, mut, quadroId, ordenar],
  );

  const soltar = useCallback(() => {
    const a = arrasto;
    setArrasto(null);
    if (!a || !a.alvo) return;
    const tarefa = tarefas.find((t) => t.id === a.id);
    if (!tarefa) return;
    const destino = grupos.find((g) => g.chave === a.alvo);
    const ids = (destino?.tarefas ?? []).map((t) => t.id).filter((id) => id !== a.id);
    const corte = a.antesDe ? ids.indexOf(a.antesDe) : ids.length;
    ids.splice(corte < 0 ? ids.length : corte, 0, a.id);
    void aplicarSolta(tarefa, a.alvo, ids);
  }, [arrasto, tarefas, grupos, aplicarSolta]);

  useEffect(() => {
    if (!arrasto) return;
    const mover = (e: PointerEvent | { clientX: number; clientY: number }) => {
      const alvoEl = document.elementFromPoint(e.clientX, e.clientY);
      const grupoEl = alvoEl?.closest?.("[data-grupo]") as HTMLElement | null;
      const cartaoEl = alvoEl?.closest?.("[data-tarefa]") as HTMLElement | null;
      let antesDe: string | null = null;
      if (cartaoEl && cartaoEl.dataset.tarefa !== arrasto.id) {
        const r = cartaoEl.getBoundingClientRect();
        antesDe = e.clientY < r.top + r.height / 2 ? cartaoEl.dataset.tarefa ?? null : null;
        if (!antesDe) {
          const irmao = cartaoEl.nextElementSibling as HTMLElement | null;
          antesDe = irmao?.dataset?.tarefa ?? null;
        }
      }
      setArrasto((prev) =>
        prev
          ? { ...prev, alvo: grupoEl?.dataset.grupo ?? null, antesDe, x: e.clientX, y: e.clientY }
          : prev,
      );
    };
    const onMove = (e: PointerEvent) => { e.preventDefault(); mover(e); };
    const onUp = () => soltar();
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [arrasto, soltar]);

  function pegar(tarefa: Tarefa, grupo: string, e: React.PointerEvent) {
    // campos e botões não arrastam — ali é edição. O punho (⠿) é a exceção:
    // ali o arrasto começa na hora.
    const alvo = e.target as HTMLElement;
    const noPunho = !!alvo.closest(".q-pun");
    if (!noPunho && alvo.closest("input, select, textarea, button, a, [contenteditable='true']")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    arrastouRef.current = false;
    const x0 = e.clientX, y0 = e.clientY;
    const limiar = noPunho ? 3 : e.pointerType === "mouse" ? 6 : 10;

    const começa = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) < limiar && Math.abs(ev.clientY - y0) < limiar) return;
      arrastouRef.current = true;
      setArrasto({ id: tarefa.id, origem: grupo, alvo: grupo, antesDe: null, x: ev.clientX, y: ev.clientY });
      window.removeEventListener("pointermove", começa);
    };
    const solta = () => {
      window.removeEventListener("pointermove", começa);
      window.removeEventListener("pointerup", solta);
    };
    window.addEventListener("pointermove", começa);
    window.addEventListener("pointerup", solta);
  }

  // Quantas tarefas cada coluna tem ANTES da busca dela — pra poder dizer
  // "3 escondidas pela busca" em vez de a pessoa achar que sumiram.
  const grupoBruto = useMemo(() => {
    const base =
      visao === "colunas" && modo === "situacao" ? colunasKanban(visiveis) : agrupar(visiveis, modo);
    return new Map(base.map((g) => [g.chave, g.tarefas.length]));
  }, [visiveis, modo, visao]);

  const arrastando = !!arrasto;
  const emColunas = visao === "colunas";
  const emTabela = visao === "tabela";

  function Cartao({ t, grupo }: { t: Tarefa; grupo: string }) {
    return (
      <div
        data-tarefa={t.id}
        onPointerDown={(e) => pegar(t, grupo, e)}
        onClickCapture={(e) => {
          if (arrastouRef.current) {
            e.stopPropagation();
            e.preventDefault();
            arrastouRef.current = false;
          }
        }}
        className={cn(
          "q-linha relative touch-pan-y",
          arrasto?.id === t.id && "opacity-30",
          arrasto?.antesDe === t.id &&
            "before:content-[''] before:absolute before:-top-1 before:left-0 before:right-0 before:h-[3px] before:rounded-full before:bg-[color:var(--foreground)]",
        )}
      >
        <QuadroTarefa
          tarefa={t}
          pessoasDoQuadro={nomesNoQuadro}
          onTirarDoQuadro={onRemoveFromBoard ? () => onRemoveFromBoard(t.id) : undefined}
        />
      </div>
    );
  }

  const TOM_MARCADOR: Record<string, string> = {
    vencida: "bg-[color:var(--urgent)]",
    hoje: "bg-[color:var(--warm)]",
    semana: "bg-[color:var(--warm)]",
    concluida: "bg-[color:var(--done)]",
    feito: "bg-[color:var(--done)]",
    em_andamento: "bg-[color:var(--warm)]",
    aguardando_aprovacao: "bg-[color:var(--calm)]",
  };

  // A régua da coluna: como ela ordena e o que ela busca. Fica sempre à vista,
  // porque controle escondido é controle que ninguém acha.
  function ReguaDaColuna({
    chave,
    regua,
    onMudar,
    escondidas,
  }: {
    chave: string;
    regua: { ordem?: OrdemColuna; busca?: string };
    onMudar: (m: { ordem?: OrdemColuna; busca?: string }) => void;
    escondidas: number;
  }) {
    const ordem = regua.ordem ?? ordemPadraoDaColuna(chave);
    const busca = regua.busca ?? "";
    return (
      <div className="mt-1 flex items-center gap-1">
        <span className="relative flex-1 min-w-[60px]">
          <Search
            size={11}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[color:var(--muted)]"
          />
          <input
            value={busca}
            onChange={(e) => onMudar({ busca: e.target.value })}
            placeholder="buscar aqui"
            aria-label={`Buscar dentro da coluna ${chave}`}
            className="w-full rounded-md border border-[color:var(--border)] bg-[color:var(--card)] pl-6 pr-5 py-1 text-[11.5px] outline-none focus:border-[color:var(--muted-strong)]"
          />
          {busca && (
            <button
              type="button"
              onClick={() => onMudar({ busca: "" })}
              aria-label="Limpar a busca desta coluna"
              className="absolute right-1 top-1/2 -translate-y-1/2 text-[color:var(--muted)] p-0.5"
            >
              <X size={10} />
            </button>
          )}
        </span>
        <select
          value={ordem}
          onChange={(e) => onMudar({ ordem: e.target.value as OrdemColuna })}
          aria-label={`Ordenar a coluna ${chave}`}
          title="Ordem só desta coluna"
          className={cn(
            "shrink-0 w-[152px] truncate rounded-md border px-1 py-1 text-[11.5px] font-medium cursor-pointer outline-none",
            ordem === ordemPadraoDaColuna(chave)
              ? "border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--muted-strong)]"
              : "border-[color:var(--foreground)]/40 bg-[color:var(--accent)] text-[color:var(--foreground)]",
          )}
        >
          {ORDENS_COLUNA.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
        {escondidas > 0 && (
          <span
            title={`${escondidas} escondida${escondidas > 1 ? "s" : ""} pela busca desta coluna`}
            className="shrink-0 text-[11px] font-semibold text-[color:var(--muted)]"
          >
            +{escondidas}
          </span>
        )}
      </div>
    );
  }

  function CabecalhoGrupo({ g }: { g: Grupo }) {
    const abertas = g.tarefas.filter((t) => t.status !== "concluida").length;
    const atrasadas = g.tarefas.filter((t) => faixaDoPrazo(t) === "vencida").length;
    return (
      <div className="flex items-center gap-2.5 flex-wrap px-0.5 pb-1">
        <span
          className={cn(
            "w-2.5 h-2.5 rounded-[3px] shrink-0",
            TOM_MARCADOR[g.chave] ?? "bg-[color:var(--muted-strong)]",
          )}
          aria-hidden
        />
        <h3 className="font-display text-[20px] font-normal">{g.rotulo}</h3>
        <span className="text-[12.5px] font-semibold text-[color:var(--muted)]">
          {modo === "pessoa" || modo === "tema"
            ? `${abertas} abertas de ${g.tarefas.length}`
            : `${g.tarefas.length} ${g.tarefas.length === 1 ? "tarefa" : "tarefas"}`}
          {atrasadas > 0 && (
            <span className="text-[color:var(--urgent)]">
              {" "}
              · {atrasadas} atrasada{atrasadas > 1 ? "s" : ""}
            </span>
          )}
        </span>
        {g.nota && <span className="text-[12px] text-[color:var(--muted)]">— {g.nota}</span>}
      </div>
    );
  }

  const grupoTudo: Grupo = { chave: "tudo", rotulo: "Todas as tarefas", tarefas: visiveis };

  return (
    <div className="flex flex-col gap-4">
      <QuadroResumo
        tarefas={tarefas}
        pessoaFiltrada={filtros.pessoa}
        onFiltrarPessoa={(chave) => setFiltros({ ...filtros, pessoa: chave })}
      />

      <QuadroControles
        tarefas={tarefas}
        visao={visao}
        setVisao={trocarVisao}
        filtros={filtros}
        setFiltros={setFiltros}
        verPor={verPor}
        setVerPor={setVerPor}
        ordenar={ordenar}
        setOrdenar={setOrdenar}
        maisAberto={maisAberto}
        setMaisAberto={setMaisAberto}
        visiveis={visiveis.length}
      />

      {visao === "timeline" ? (
        <PlanoTimeline tarefas={tarefas} quadroId={quadroId} showManageButton={false} />
      ) : (
        <>
          <div ref={criarRef}>
            <QuadroCriar tarefas={tarefas} />
          </div>

          {visiveis.length === 0 ? (
            <div className="text-center py-12 text-[color:var(--muted)]">
              <p className="font-display text-[22px] text-[color:var(--foreground)] mb-1.5">
                Nada com esses filtros.
              </p>
              <p className="text-[13px]">Tire um filtro ou limpe tudo pra ver as tarefas de novo.</p>
            </div>
          ) : emColunas ? (
            /* Kanban: cada coluna tem largura própria e a fileira rola de lado
               quando não cabe. Com "auto-fit" as colunas encolhiam pra caber e
               a quarta ia parar 10 mil pixels abaixo da página. */
            <div className="q-colunas flex items-start gap-3 overflow-x-auto pb-4 -mx-1 px-1">
              {grupos.map((g) => (
                <section
                  key={g.chave}
                  data-grupo={g.chave}
                  className={cn(
                    "q-coluna rounded-2xl border p-2.5 flex flex-col gap-2 transition",
                    arrastando && arrasto?.alvo === g.chave && modo !== "prazo"
                      ? "border-[color:var(--foreground)] q-coluna-alvo"
                      : arrastando && arrasto?.alvo === g.chave
                      ? "border-[color:var(--urgent)]/60"
                      : "border-[color:var(--border)]",
                  )}
                >
                  <div className="q-coluna-cab">
                    <CabecalhoGrupo g={g} />
                    <ReguaDaColuna
                      chave={g.chave}
                      regua={reguas[g.chave] ?? {}}
                      onMudar={(mudanca) =>
                        setReguas((r) => ({ ...r, [g.chave]: { ...r[g.chave], ...mudanca } }))
                      }
                      escondidas={
                        (grupoBruto.get(g.chave) ?? g.tarefas.length) - g.tarefas.length
                      }
                    />
                  </div>
                  <div className="q-coluna-corpo flex flex-col gap-2">
                    {g.tarefas.map((t) => (
                      <Cartao key={t.id} t={t} grupo={g.chave} />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => criarRef.current?.querySelector("button")?.click()}
                    className="shrink-0 mt-1 w-full rounded-lg border border-dashed border-[color:var(--border)] py-1.5 text-[12.5px] font-semibold text-[color:var(--muted)] hover:border-[color:var(--foreground)] hover:text-[color:var(--foreground)] transition"
                  >
                    + tarefa aqui
                  </button>
                </section>
              ))}
            </div>
          ) : emTabela ? (
            <div className="q-tabela overflow-x-auto">
              <div className="min-w-[900px]">
                <div className="q-cabecalho-tabela px-3.5 pb-2 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--muted)]">
                  <span />
                  <span>O quê</span>
                  <span>Dono</span>
                  <span>Vence em</span>
                  <span>Situação</span>
                  <span>Resumo</span>
                  <span>Tema</span>
                  <span />
                </div>
                <div className="flex flex-col gap-4">
                  {(modo === "nada" ? [grupoTudo] : grupos).map((g) => (
                    <section
                      key={g.chave}
                      data-grupo={g.chave}
                      className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] pt-3"
                    >
                      <div className="px-3.5">
                        <CabecalhoGrupo g={g} />
                      </div>
                      <div className="flex flex-col">
                        {g.tarefas.map((t) => (
                          <Cartao key={t.id} t={t} grupo={g.chave} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {(modo === "nada" ? [grupoTudo] : grupos).map((g) => (
                <section key={g.chave} data-grupo={g.chave} className="flex flex-col gap-2">
                  <CabecalhoGrupo g={g} />
                  <div
                    className={cn(
                      "flex flex-col gap-2 rounded-xl transition",
                      arrastando &&
                        arrasto?.alvo === g.chave &&
                        modo !== "prazo" &&
                        "ring-2 ring-[color:var(--foreground)]/30 ring-offset-2 ring-offset-[color:var(--background)]",
                    )}
                  >
                    {g.tarefas.map((t) => (
                      <Cartao key={t.id} t={t} grupo={g.chave} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

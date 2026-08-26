"use client";

// Tela das tarefas dentro de um quadro.
// Três formatos (Lista, Colunas/Kanban e Tabela) sobre a MESMA lista, com
// "Ver por" mandando no agrupamento — a página não é presa à situação.
// Arrastar funciona pegando o cartão inteiro; soltar em outro grupo muda a
// situação (ou o dono, ou o tema, conforme o "Ver por").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TaskRow } from "./task-row";
import { QuadroControles, type Visao } from "./quadro-controles";
import { useTaskMutations } from "@/lib/task-mutations";
import {
  FILTROS_VAZIOS,
  ORDEM_KANBAN,
  agrupar,
  colunasKanban,
  comparar,
  donoDe,
  passa,
  rotuloSituacao,
  type Filtros,
  type Grupo,
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
}: {
  tarefas: Tarefa[];
  /** Só o dono "remove do quadro" (desvincula sem apagar). */
  onRemoveFromBoard?: (id: string) => void;
  /** Necessário pra guardar a ordem que a pessoa montou arrastando. */
  quadroId?: string;
}) {
  const mut = useTaskMutations();
  const [visao, setVisao] = useState<Visao>("lista");
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [verPor, setVerPor] = useState<VerPor>("nada");
  const [ordenar, setOrdenar] = useState<Ordenacao>("prazo");
  const [maisAberto, setMaisAberto] = useState(false);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const arrastouRef = useRef(false);

  // Em Colunas o quadro vira Kanban: sem agrupamento escolhido, agrupa por situação.
  const modo: VerPor = visao === "colunas" && verPor === "nada" ? "situacao" : verPor;

  const visiveis = useMemo(
    () => tarefas.filter((t) => passa(t, filtros)).sort((a, b) => comparar(a, b, ordenar)),
    [tarefas, filtros, ordenar],
  );

  const grupos: Grupo[] = useMemo(() => {
    if (visao === "colunas" && modo === "situacao") return colunasKanban(visiveis);
    return agrupar(visiveis, modo);
  }, [visiveis, modo, visao]);

  // ─── arrastar ───────────────────────────────────────────────────────
  const podeSoltarEm = useCallback(
    (grupo: string) => modo !== "prazo" && modo !== "nada" ? true : modo === "nada",
    [modo],
  );

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
    // campos e botões não arrastam — ali é edição.
    const alvo = e.target as HTMLElement;
    if (alvo.closest("input, select, textarea, button, a, [contenteditable='true']")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    arrastouRef.current = false;
    const x0 = e.clientX, y0 = e.clientY;
    const limiar = e.pointerType === "mouse" ? 6 : 10;

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

  const arrastando = !!arrasto;
  const emColunas = visao === "colunas";

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
          "group relative touch-pan-y",
          arrasto?.id === t.id && "opacity-30",
          arrasto?.antesDe === t.id && "before:content-[''] before:absolute before:-top-1.5 before:left-0 before:right-0 before:h-[3px] before:rounded-full before:bg-[color:var(--foreground)]",
        )}
      >
        <TaskRow tarefa={t} noQuadro />
        {onRemoveFromBoard && !arrastando && (
          <button
            type="button"
            onClick={() => onRemoveFromBoard(t.id)}
            title="Tirar do quadro (não apaga a tarefa)"
            className="absolute -top-2 right-2 z-10 text-[10px] tracking-wide px-2 py-0.5 rounded-full border border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--muted)] opacity-0 group-hover:opacity-100 hover:text-[color:var(--urgent)] transition"
          >
            tirar do quadro
          </button>
        )}
      </div>
    );
  }

  function CabecalhoGrupo({ g }: { g: Grupo }) {
    const abertas = g.tarefas.filter((t) => t.status !== "concluida").length;
    const atrasadas = g.tarefas.filter(
      (t) => t.status !== "concluida" && t.prazo && new Date(t.prazo) < new Date(new Date().toDateString()),
    ).length;
    return (
      <div className="flex items-center gap-2 flex-wrap px-0.5">
        <h3 className="font-serif text-[17px]">{g.rotulo}</h3>
        <span className="text-[12px] text-[color:var(--muted)]">
          {modo === "pessoa" || modo === "tema"
            ? `${abertas} abertas de ${g.tarefas.length}`
            : `${g.tarefas.length} ${g.tarefas.length === 1 ? "tarefa" : "tarefas"}`}
          {atrasadas > 0 && (
            <span className="text-[color:var(--urgent)] font-semibold"> · {atrasadas} atrasada{atrasadas > 1 ? "s" : ""}</span>
          )}
        </span>
        {g.nota && <span className="text-[11.5px] text-[color:var(--muted)]">— {g.nota}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <QuadroControles
        tarefas={tarefas}
        visao={visao}
        setVisao={setVisao}
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

      {visiveis.length === 0 ? (
        <div className="text-center py-12 text-[color:var(--muted)]">
          <p className="font-serif text-[20px] text-[color:var(--foreground)] mb-1">
            Nada com esses filtros.
          </p>
          <p className="text-[13px]">Tire um filtro ou limpe tudo pra ver as tarefas de novo.</p>
        </div>
      ) : emColunas ? (
        <div className="grid gap-3 items-start overflow-x-auto pb-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {grupos.map((g) => (
            <section
              key={g.chave}
              data-grupo={g.chave}
              className={cn(
                "rounded-2xl border p-2.5 flex flex-col gap-2 min-h-[120px] transition",
                arrastando && arrasto?.alvo === g.chave && modo !== "prazo"
                  ? "border-[color:var(--foreground)] bg-[color:var(--accent)]/50"
                  : arrastando && arrasto?.alvo === g.chave
                  ? "border-[color:var(--urgent)]/60"
                  : "border-[color:var(--border)] bg-[color:var(--accent)]/25",
              )}
            >
              <CabecalhoGrupo g={g} />
              <div className="flex flex-col gap-2">
                {g.tarefas.map((t) => (
                  <Cartao key={t.id} t={t} grupo={g.chave} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {grupos.map((g) => (
            <section key={g.chave} data-grupo={g.chave} className="flex flex-col gap-2">
              {modo !== "nada" && <CabecalhoGrupo g={g} />}
              <div
                className={cn(
                  "flex flex-col gap-2 rounded-xl transition",
                  arrastando && arrasto?.alvo === g.chave && modo !== "prazo" && "ring-2 ring-[color:var(--foreground)]/30 ring-offset-2 ring-offset-[color:var(--background)]",
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

      {visao === "tabela" && (
        <p className="text-[12px] text-[color:var(--muted)] text-center">
          Na tabela, a linha mostra o quê, quem, quando vence, a situação, o resumo e o tema — clique em qualquer um pra editar.
        </p>
      )}
    </div>
  );
}

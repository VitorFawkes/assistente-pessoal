"use client";

// A faixa que abre o quadro: quantas atrasadas, quantas até sexta, quantas
// estão sendo feitas, o quanto já andou — e quem está no quadro.
// Clicar num nome filtra por ele; o lápis corrige o nome em todas as tarefas.
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTaskMutations } from "@/lib/task-mutations";
import { corDaPessoa, iniciais, numerosDoQuadro, pessoasDoQuadro } from "@/lib/quadro-v2";
import type { Tarefa } from "@/lib/queries";

function Numero({
  valor,
  rotulo,
  tom,
}: {
  valor: number;
  rotulo: string;
  tom?: "perigo" | "alerta";
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <b
        className={cn(
          "text-[22px] font-bold tracking-tight",
          tom === "perigo"
            ? "text-[color:var(--urgent)]"
            : tom === "alerta"
            ? "text-[color:var(--warm)]"
            : "text-[color:var(--foreground)]",
        )}
      >
        {valor}
      </b>
      <span className="text-[12.5px] font-semibold text-[color:var(--muted)]">{rotulo}</span>
    </span>
  );
}

function PilulaPessoa({
  nome,
  chave,
  abertas,
  atrasadas,
  ativa,
  onFiltrar,
  onRenomear,
}: {
  nome: string;
  chave: string;
  abertas: number;
  atrasadas: number;
  ativa: boolean;
  onFiltrar: () => void;
  onRenomear?: (novo: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const cor = corDaPessoa(chave === "__sem__" ? null : nome);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border overflow-hidden text-[12.5px] font-semibold transition",
        cor,
        ativa
          ? "border-[color:var(--foreground)] bg-[color:var(--accent)]"
          : "border-[color:var(--border)] bg-[color:var(--card)] hover:border-[color:var(--muted)]",
      )}
    >
      {editando && onRenomear ? (
        <input
          autoFocus
          defaultValue={nome}
          onBlur={(e) => {
            setEditando(false);
            const novo = e.target.value.trim();
            if (novo && novo !== nome) onRenomear(novo);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditando(false);
          }}
          className="w-28 bg-transparent px-2.5 py-1 outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onFiltrar}
          title={`ver só as tarefas de ${nome}`}
          className="inline-flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 text-[color:var(--muted-strong)]"
        >
          <span className="q-ini">{chave === "__sem__" ? "—" : iniciais(nome)}</span>
          <span>{nome}</span>
          <span className="text-[11.5px] font-bold text-[color:var(--muted)]">{abertas}</span>
          {atrasadas > 0 && (
            <span className="text-[11.5px] font-bold text-[color:var(--urgent)]">
              · {atrasadas} atrasada{atrasadas > 1 ? "s" : ""}
            </span>
          )}
        </button>
      )}
      {onRenomear && !editando && (
        <button
          type="button"
          onClick={() => setEditando(true)}
          title={`corrigir o nome de ${nome}`}
          className="self-stretch border-l border-[color:var(--border)] px-2 text-[11px] text-[color:var(--muted)] hover:bg-[color:var(--accent)]"
        >
          ✎
        </button>
      )}
    </span>
  );
}

export function QuadroResumo({
  tarefas,
  pessoaFiltrada,
  onFiltrarPessoa,
}: {
  tarefas: Tarefa[];
  pessoaFiltrada: string;
  onFiltrarPessoa: (chave: string) => void;
}) {
  const mut = useTaskMutations();
  const n = numerosDoQuadro(tarefas);
  const pessoas = pessoasDoQuadro(tarefas);

  // Corrigir o nome vale pro quadro inteiro: renomeia em todas as tarefas em
  // que a pessoa aparece, não só na linha em que se clicou.
  async function renomear(velho: string, novo: string) {
    const alvo = tarefas.filter((t) => t.pessoas.some((p) => p.nome === velho));
    if (!alvo.length) return;
    for (const t of alvo) {
      await mut.patch(
        t.id,
        {
          pessoas: t.pessoas.map((p) => ({
            nome: p.nome === velho ? novo : p.nome,
            principal: p.principal,
          })),
          ...(t.owner === velho ? { owner: novo } : {}),
        },
        { silent: true },
      );
    }
    toast.success(`"${velho}" virou "${novo}" em ${alvo.length} tarefa${alvo.length > 1 ? "s" : ""}`);
  }

  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      <Numero valor={n.atrasadas} rotulo="atrasadas" tom="perigo" />
      <span className="w-px h-6 bg-[color:var(--border)] hidden sm:block" />
      <Numero valor={n.ateSexta} rotulo="até sexta" tom="alerta" />
      <span className="w-px h-6 bg-[color:var(--border)] hidden sm:block" />
      <Numero valor={n.fazendo} rotulo="fazendo agora" />

      <span className="flex-1 min-w-[170px] flex items-center gap-2.5">
        <span className="flex-1 h-[7px] rounded-full bg-[color:var(--accent)] overflow-hidden">
          <span
            className="block h-full rounded-full bg-[color:var(--done)] transition-[width] duration-500"
            style={{ width: `${n.porcento}%` }}
          />
        </span>
        <small className="whitespace-nowrap text-[12px] font-semibold text-[color:var(--muted)]">
          {n.feitas} de {n.total} feitas
        </small>
      </span>

      <div className="w-full pt-2.5 mt-0.5 border-t border-dashed border-[color:var(--border)] flex flex-wrap gap-1.5">
        <span className="w-full mb-0.5 text-[11.5px] font-bold uppercase tracking-wide text-[color:var(--muted)]">
          Quem está no quadro{" "}
          <small className="normal-case tracking-normal font-semibold opacity-80">
            (clique no nome pra filtrar, no lápis pra corrigir)
          </small>
        </span>
        {pessoas.map((p) => (
          <PilulaPessoa
            key={p.chave}
            nome={p.nome}
            chave={p.chave}
            abertas={p.abertas}
            atrasadas={p.atrasadas}
            ativa={pessoaFiltrada === p.chave}
            onFiltrar={() => onFiltrarPessoa(pessoaFiltrada === p.chave ? "" : p.chave)}
            onRenomear={
              p.chave === "__sem__" ? undefined : (novo) => void renomear(p.nome, novo)
            }
          />
        ))}
      </div>
    </section>
  );
}

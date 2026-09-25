import Link from "next/link";
import { cn } from "@/lib/utils";
import { corDaPessoa, iniciais } from "@/lib/quadro-v2";
import type { ProjetoResumo } from "@/lib/projetos";
import { NovoQuadro } from "./novo-quadro";

// Equipe: a lista de projetos. Espelha a lista de quadros do Vitor (cartões na grade),
// com o que importa quando o projeto é de várias pessoas: de quem é e quem está nele.

const MAX_ROSTOS = 5;

function Rostos({ pessoas }: { pessoas: ProjetoResumo["pessoas"] }) {
  const vis = pessoas.slice(0, MAX_ROSTOS);
  const resto = pessoas.length - vis.length;
  return (
    <span className="flex items-center -space-x-1.5" title={pessoas.map((p) => p.nome).join(", ")}>
      {vis.map((p) => (
        <span
          key={p.user_id}
          className={cn("q-ini ring-2 ring-[color:var(--card)]", corDaPessoa(p.nome))}
          aria-hidden
        >
          {iniciais(p.nome)}
        </span>
      ))}
      {resto > 0 && (
        <span className="q-ini ring-2 ring-[color:var(--card)] bg-[color:var(--accent)] text-[color:var(--muted-strong)]">
          +{resto}
        </span>
      )}
      <span className="sr-only">{pessoas.map((p) => p.nome).join(", ")}</span>
    </span>
  );
}

export function ProjetosLista({ projetos }: { projetos: ProjetoResumo[] }) {
  return (
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">Projetos</p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          O que a equipe{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">toca junto.</span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Junte tarefas de várias reuniões num projeto e chame quem trabalha nele. Todo mundo
          do projeto vê e mexe nas tarefas.
        </p>
        {projetos.length > 0 && (
          <div className="pt-1">
            <NovoQuadro />
          </div>
        )}
      </header>

      {projetos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-6 sm:p-8 space-y-5">
          <p className="text-[15px] font-medium">Nenhum projeto ainda.</p>
          <ol className="space-y-2 text-[14px] text-[color:var(--muted-strong)]">
            <li>
              <span className="font-semibold text-[color:var(--foreground)]">1.</span>{" "}Crie um
              projeto, por exemplo &ldquo;Lançamento Weddings 2027&rdquo;.
            </li>
            <li>
              <span className="font-semibold text-[color:var(--foreground)]">2.</span>{" "}Chame as
              pessoas que trabalham nele.
            </li>
            <li>
              <span className="font-semibold text-[color:var(--foreground)]">3.</span>{" "}Traga as
              tarefas das suas reuniões.
            </li>
          </ol>
          <NovoQuadro autoOpen />
        </div>
      ) : (
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projetos.map((p) => {
            const dono = p.pessoas.find((x) => x.e_dono);
            return (
              <Link
                key={p.id}
                href={`/quadros/${p.id}`}
                className="flex flex-col rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-5 hover:border-[color:var(--muted)] hover:bg-[color:var(--accent)]/20 transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold min-w-0 break-words">{p.nome}</h3>
                  {p.vista_padrao === "timeline" && (
                    <span className="shrink-0 rounded-full bg-[color:var(--accent)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--muted-strong)]">
                      linha do tempo
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] text-[color:var(--muted)]">
                  {p.sou_dono ? "Criado por você" : `Criado por ${dono?.nome ?? "um colega"}`}
                </p>
                {p.descricao && (
                  <p className="mt-2 text-sm text-[color:var(--muted-strong)] line-clamp-2">{p.descricao}</p>
                )}
                <div className="mt-auto pt-4 flex items-center justify-between gap-3 text-xs text-[color:var(--muted)]">
                  <Rostos pessoas={p.pessoas} />
                  <span>
                    {p.n_tarefas} tarefa{p.n_tarefas !== 1 ? "s" : ""}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

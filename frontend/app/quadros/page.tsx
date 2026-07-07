import { requireUserOrRedirect } from "@/lib/auth";
import { quadrosFor, type QuadroComContagem } from "@/lib/quadros";
import { NovoQuadro } from "@/components/novo-quadro";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function QuadrosPage() {
  const user = await requireUserOrRedirect();
  let quadros: QuadroComContagem[] = [];
  let error: string | null = null;

  try {
    quadros = await quadrosFor(user.id).list();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-6">
        <h2 className="text-sm font-semibold text-[color:var(--urgent)]">
          Erro ao carregar quadros
        </h2>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-[color:var(--urgent)]/90">
          {error}
        </pre>
        <p className="mt-3 text-xs text-[color:var(--muted-strong)]">
          Se a tabela <code>quadros</code> não existe, aplicar{" "}
          <code>db/0019_quadros.sql</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Quadros
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          Listas <span className="italic font-[450] text-[color:var(--muted-strong)]">compartilhadas.</span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Cura tarefas manualmente e compartilhe com convidados via link seguro
          e passwordless.
        </p>
        <div className="pt-1">
          <NovoQuadro />
        </div>
      </header>

      {quadros.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border)] p-8 text-center space-y-4">
          <p className="text-sm text-[color:var(--muted-strong)]">
            Nenhum quadro ainda. Crie o primeiro:
          </p>
          <div className="flex justify-center">
            <NovoQuadro autoOpen />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {quadros.map((q) => (
            <Link
              key={q.id}
              href={`/quadros/${q.id}`}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-5 hover:border-[color:var(--accent)] hover:bg-[color:var(--muted)]/5 transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-lg font-semibold">
                  {q.nome}
                </h3>
                {q.vista_padrao === "timeline" && (
                  <span className="shrink-0 rounded-full bg-[color:var(--accent)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--muted-strong)]">
                    linha do tempo
                  </span>
                )}
              </div>
              {q.descricao && (
                <p className="mt-2 text-sm text-[color:var(--muted-strong)]">
                  {q.descricao}
                </p>
              )}
              <div className="mt-4 flex gap-4 text-xs text-[color:var(--muted)]">
                <span>{q.n_tarefas} tarefa{q.n_tarefas !== 1 ? "s" : ""}</span>
                <span>{q.n_convidados} convidado{q.n_convidados !== 1 ? "s" : ""}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

import { requireUserOrRedirect } from "@/lib/auth";
import { pessoasFor } from "@/lib/queries";
import { PessoasManager, type PessoaListItem } from "@/components/pessoas-manager";

export const dynamic = "force-dynamic";

export default async function PessoasPage() {
  const user = await requireUserOrRedirect();
  let pessoas: PessoaListItem[] = [];
  let error: string | null = null;
  try {
    pessoas = (await pessoasFor(user.id).listForIndex()) as unknown as PessoaListItem[];
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-6">
        <h2 className="text-sm font-semibold text-[color:var(--urgent)]">
          Erro ao carregar pessoas
        </h2>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-[color:var(--urgent)]/90">
          {error}
        </pre>
        <p className="mt-3 text-xs text-[color:var(--muted-strong)]">
          Se a tabela <code>pessoas</code> não existe, aplicar{" "}
          <code>db/0004_pessoas.sql</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Pessoas
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          Quem aparece nas{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            gravações.
          </span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Cada voz que você identifica numa gravação vira uma pessoa aqui. Os
          apelidos juntam variações do mesmo nome (Ana, Aninha) numa pessoa só.
        </p>
      </header>

      <PessoasManager initial={pessoas} />
    </div>
  );
}

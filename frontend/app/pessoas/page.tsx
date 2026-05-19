import { query } from "@/lib/db";
import { PessoasManager, type PessoaListItem } from "@/components/pessoas-manager";

export const dynamic = "force-dynamic";

async function fetchPessoas(): Promise<PessoaListItem[]> {
  return query<PessoaListItem>(`
    SELECT
      p.id, p.nome, p.aliases, p.is_vitor, p.notas,
      COALESCE((
        SELECT count(DISTINCT m.id)::int
        FROM meetings m, jsonb_each_text(m.speaker_pessoas) AS sp(letter, pid)
        WHERE sp.pid = p.id::text
      ), 0) AS n_reunioes
    FROM pessoas p
    ORDER BY p.is_vitor DESC, p.nome ASC
  `);
}

export default async function PessoasPage() {
  let pessoas: PessoaListItem[] = [];
  let error: string | null = null;
  try {
    pessoas = await fetchPessoas();
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
          Cada speaker rotulado vira uma pessoa aqui. Aliases ajudam a casar
          variações de nome; notas alimentam o reconhecimento por voz no futuro.
        </p>
      </header>

      <PessoasManager initial={pessoas} />
    </div>
  );
}

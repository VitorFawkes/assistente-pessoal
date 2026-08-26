"use client";

// Abas do quadro: Tarefas e Ideias. Um clique troca, sem sair da página.
import { cn } from "@/lib/utils";

export function QuadroAbas({
  pagina,
  setPagina,
  quantasTarefas,
  quantasIdeias,
}: {
  pagina: "tarefas" | "ideias";
  setPagina: (p: "tarefas" | "ideias") => void;
  quantasTarefas: number;
  quantasIdeias: number;
}) {
  const abas: { valor: "tarefas" | "ideias"; rotulo: string; n: number }[] = [
    { valor: "tarefas", rotulo: "Tarefas", n: quantasTarefas },
    { valor: "ideias", rotulo: "Ideias", n: quantasIdeias },
  ];
  return (
    <nav className="inline-flex rounded-lg border border-[color:var(--border)] bg-[color:var(--accent)]/40 p-0.5 gap-0.5">
      {abas.map((a) => (
        <button
          key={a.valor}
          type="button"
          onClick={() => setPagina(a.valor)}
          aria-pressed={pagina === a.valor}
          className={cn(
            "px-3.5 py-1.5 rounded-md text-[13px] font-medium inline-flex items-center gap-2 transition",
            pagina === a.valor
              ? "bg-[color:var(--card)] text-[color:var(--foreground)] shadow-sm"
              : "text-[color:var(--muted-strong)] hover:text-[color:var(--foreground)]",
          )}
        >
          {a.rotulo}
          <span
            className={cn(
              "text-[11px] font-bold px-1.5 rounded-full",
              pagina === a.valor
                ? "bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
                : "text-[color:var(--muted)]",
            )}
          >
            {a.n}
          </span>
        </button>
      ))}
    </nav>
  );
}

import { requireUserOrRedirect } from "@/lib/auth";
import { tarefasFor } from "@/lib/queries";
import { type Tarefa } from "@/lib/queries";
import { PlanoTimeline } from "@/components/plano-timeline";
import { OwnerTaskProvider } from "@/lib/task-mutations";

export const dynamic = "force-dynamic";

export default async function PlanoPage() {
  const user = await requireUserOrRedirect();

  let tarefas: Tarefa[] = [];
  let dbError: string | null = null;
  try {
    tarefas = (await tarefasFor(user.id).recentes()) as unknown as Tarefa[];
  } catch (e: unknown) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  if (dbError) {
    return (
      <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-6">
        <h2 className="text-sm font-semibold text-[color:var(--urgent)]">
          Não consegui conectar no banco
        </h2>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-[color:var(--urgent)]/90">
          {dbError}
        </pre>
      </div>
    );
  }

  return (
    <OwnerTaskProvider>
      <div className="space-y-7 sm:space-y-9">
        <header className="space-y-2">
          <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
            Plano de ação
          </p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
            A linha do{" "}
            <span className="italic font-[450] text-[color:var(--muted-strong)]">
              tempo.
            </span>
          </h1>
          <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
            Quem faz o quê e quando. Arraste as barras pra reagendar, marque o
            andamento e mostre o avanço na hora — tudo editável direto aqui.
          </p>
        </header>

        {/* full-bleed: a timeline escapa da coluna estreita e usa a tela toda */}
        <div className="mx-[calc(50%-50vw)] px-5 sm:px-8 overflow-x-clip">
          <div className="mx-auto max-w-[1500px]">
            <PlanoTimeline tarefas={tarefas} />
          </div>
        </div>
      </div>
    </OwnerTaskProvider>
  );
}

import { requireUserOrRedirect } from "@/lib/auth";
import { quadrosFor, type Quadro, type QuadroConvidado, type AtividadeItem } from "@/lib/quadros";
import { type Tarefa } from "@/lib/queries";
import { QuadroManager } from "@/components/quadro-manager";

export const dynamic = "force-dynamic";

export default async function QuadroDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUserOrRedirect();

  let quadro: Quadro | null = null;
  let tarefas: Tarefa[] = [];
  let convidados: QuadroConvidado[] = [];
  let atividade: AtividadeItem[] = [];
  let error: string | null = null;

  try {
    quadro = await quadrosFor(user.id).get(id);
    if (!quadro) {
      error = "Quadro não encontrado";
    } else {
      tarefas = await quadrosFor(user.id).tarefas(id);
      convidados = await quadrosFor(user.id).convidados(id);
      atividade = await quadrosFor(user.id).atividade(id);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-6">
        <h2 className="text-sm font-semibold text-[color:var(--urgent)]">
          Erro
        </h2>
        <p className="mt-2 text-sm text-[color:var(--urgent)]/90">{error}</p>
      </div>
    );
  }

  if (!quadro) {
    return (
      <div className="rounded-2xl border border-[color:var(--muted)]/30 p-6">
        <p className="text-sm text-[color:var(--muted-strong)]">
          Quadro não encontrado
        </p>
      </div>
    );
  }

  // full-bleed: escapa do <main max-w-3xl> do layout pra usar a largura da tela
  return (
    <div className="mx-[calc(50%-50vw)] px-5 sm:px-8 overflow-x-clip">
      <div className="mx-auto max-w-[1400px]">
        <QuadroManager
          quadro={quadro}
          tarefas={tarefas}
          convidados={convidados}
          atividade={atividade}
        />
      </div>
    </div>
  );
}

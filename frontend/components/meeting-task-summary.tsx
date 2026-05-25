import { CheckCircle2, Bell, Hourglass, HelpCircle } from "lucide-react";
import type { Tarefa } from "./task-row";

type Props = {
  tarefas: Tarefa[];
};

export function MeetingTaskSummary({ tarefas }: Props) {
  if (tarefas.length === 0) return null;

  const abertas = tarefas.filter(
    (t) => t.status !== "concluida" && t.status !== "cancelada",
  );
  const executar = abertas.filter((t) => t.acao === "executar").length;
  const cobrar = abertas.filter((t) => t.acao === "cobrar").length;
  const aguardar = abertas.filter((t) => t.acao === "aguardar").length;
  const semOwner = abertas.filter(
    (t) => !t.owner || t.owner === "?" || t.owner.trim() === "",
  ).length;

  return (
    <div className="paper-card rounded-2xl border border-[color:var(--border)] px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
      <span className="text-[color:var(--muted-strong)] font-medium">
        {abertas.length} tarefa{abertas.length === 1 ? "" : "s"} aberta
        {abertas.length === 1 ? "" : "s"}
      </span>

      {executar > 0 && (
        <span className="inline-flex items-center gap-1.5 text-[color:var(--calm)]">
          <CheckCircle2 size={13} strokeWidth={2} />
          <span>
            <strong className="font-semibold">{executar}</strong> executar
          </span>
        </span>
      )}

      {cobrar > 0 && (
        <span className="inline-flex items-center gap-1.5 text-[color:var(--warm)]">
          <Bell size={13} strokeWidth={2} />
          <span>
            <strong className="font-semibold">{cobrar}</strong> cobrar
          </span>
        </span>
      )}

      {aguardar > 0 && (
        <span className="inline-flex items-center gap-1.5 text-[color:var(--muted-strong)]">
          <Hourglass size={13} strokeWidth={2} />
          <span>
            <strong className="font-semibold">{aguardar}</strong> aguardando
          </span>
        </span>
      )}

      {semOwner > 0 && (
        <span className="inline-flex items-center gap-1.5 text-[color:var(--urgent)]">
          <HelpCircle size={13} strokeWidth={2} />
          <span>
            <strong className="font-semibold">{semOwner}</strong> sem responsável
          </span>
        </span>
      )}
    </div>
  );
}

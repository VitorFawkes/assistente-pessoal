// Lógica pura das ações em massa de pendências. Sem I/O — testável isolada.
// Datas em horário local (espelha o task-edit-modal: prazo = fim do dia 23:59).

export type QuickWhen = "hoje" | "amanha" | "sexta" | "proxsemana";

// Próximo dia-da-semana (0=dom..6=sáb) a partir de `from`. Se for hoje, pula pro próximo.
function nextWeekday(targetDay: number, from: Date): Date {
  const d = new Date(from);
  const cur = d.getDay();
  const delta = (targetDay - cur + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

// ISO de um prazo rápido (fim do dia local). `now` injetável p/ testes.
export function quickDeadlineISO(when: QuickWhen, now: Date = new Date()): string {
  let date: Date;
  if (when === "hoje") {
    date = new Date(now);
  } else if (when === "amanha") {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
  } else if (when === "sexta") {
    date = nextWeekday(5, now);
  } else {
    date = nextWeekday(1, now); // próxima segunda
  }
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    0,
    0,
  ).toISOString();
}

// Todas as selecionadas já estão concluídas? → botão vira "Reabrir".
export function allConcluidas(tarefas: { status: string }[]): boolean {
  return tarefas.length > 0 && tarefas.every((t) => t.status === "concluida");
}

// Status alvo e rótulo do botão de massa "Concluir/Reabrir".
export function concluirAction(
  tarefas: { status: string }[],
): { label: string; status: "aberta" | "concluida" } {
  return allConcluidas(tarefas)
    ? { label: "Reabrir", status: "aberta" }
    : { label: "Concluir", status: "concluida" };
}

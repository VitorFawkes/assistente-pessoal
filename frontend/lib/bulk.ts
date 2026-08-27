// Lógica pura das ações em massa de pendências. Sem I/O — testável isolada.
// Datas SEMPRE no horário de Brasília (ver lib/data-br.ts): "sexta" é a sexta
// daqui e o prazo é 23h59 daqui, não do fuso de quem está com a tela aberta.
import { fimDoDiaBR, hojeBR, maisDiasBR, proximoDiaDaSemanaBR } from "./data-br";

export type QuickWhen = "hoje" | "amanha" | "sexta" | "proxsemana";

/** ISO do prazo rápido: fim do dia, em Brasília. `now` injetável p/ testes. */
export function quickDeadlineISO(when: QuickWhen, now: Date | string = new Date()): string {
  const dia =
    when === "hoje" ? hojeBR(now)
    : when === "amanha" ? maisDiasBR(1, now)
    : when === "sexta" ? proximoDiaDaSemanaBR(5, now)
    : proximoDiaDaSemanaBR(1, now); // próxima segunda
  return fimDoDiaBR(dia)!;
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

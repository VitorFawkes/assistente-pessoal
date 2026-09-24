import { describe, expect, test } from "bun:test";
import { agendaText, localDayRange, type AgendaTask } from "./morning-agenda";

const SP = "America/Sao_Paulo";
const task = (titulo: string, prazo: string, today: boolean, extra: Partial<AgendaTask> = {}): AgendaTask => ({ titulo, owner: "vitor", acao: "executar", is_mine: true, prazo, today, ...extra });

describe("lista da mensagem das 8h", () => {
 test("o que vence hoje, cobranças e atrasadas, no máximo 5, e o resto vira link", () => {
  const text = agendaText([
   task("Enviar proposta", "2026-09-25T20:00:00Z", true),
   task("Contrato assinado", "2026-09-25T15:00:00Z", true, { owner: "Marcelo", acao: "cobrar", is_mine: false }),
   task("Revisar orçamento", "2026-09-23T15:00:00Z", false),
   task("Planilha de custos", "2026-09-22T15:00:00Z", false),
   task("Ligar para o fornecedor", "2026-09-20T15:00:00Z", false),
  ], { today: 3, overdue: 70 }, [], SP);
  expect(text).toBe([
   "**Para hoje**",
   "- Enviar proposta (vence hoje)",
   "- Cobrar Marcelo: Contrato assinado (vence hoje)",
   "- Revisar orçamento (venceu em 23/09)",
   "- Planilha de custos (venceu em 22/09)",
   "- Ligar para o fornecedor (venceu em 20/09)",
   "Mais 68 no Ações (1 para hoje, 67 atrasadas): https://acoes.vitorgambetti.com.br/",
  ].join("\n"));
 });
 test("sem tarefas e sem agenda, nada é acrescentado", () => {
  expect(agendaText([], { today: 0, overdue: 0 }, [], SP)).toBe("");
 });
 test("cobrança marcada com a própria pessoa como responsável não vira \"Cobrar Vitor\"", () => {
  expect(agendaText([task("Analisar currículos", "2026-09-24T15:00:00Z", false, { owner: "Vitor", acao: "cobrar", is_mine: false })], { today: 0, overdue: 1 }, [], SP))
   .toBe("**Para hoje**\n- Analisar currículos (venceu em 24/09)");
 });
 test("agenda do dia em ordem, com compromisso particular sem título", () => {
  const text = agendaText([], { today: 0, overdue: 0 }, [
   { subject: "Almoço com cliente", start: "2026-09-25T15:00:00Z", is_all_day: false, is_private: false },
   { subject: "Médico", start: "2026-09-25T12:30:00Z", is_all_day: false, is_private: true },
   { subject: "Feriado", start: "2026-09-25T00:00:00Z", is_all_day: true, is_private: false },
  ], SP);
  expect(text).toBe("**Agenda de hoje**\n- Dia inteiro: Feriado\n- 09:30 Compromisso particular\n- 12:00 Almoço com cliente");
 });
 test("o dia local vai da meia-noite à meia-noite no fuso da pessoa", () => {
  const range = localDayRange(SP, new Date("2026-09-25T02:00:00Z"));
  expect(range.from.toISOString()).toBe("2026-09-24T03:00:00.000Z");
  expect(range.to.toISOString()).toBe("2026-09-25T03:00:00.000Z");
 });
});

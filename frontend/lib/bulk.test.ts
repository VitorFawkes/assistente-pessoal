import { test, expect, describe } from "bun:test";
import { quickDeadlineISO, allConcluidas, concluirAction } from "./bulk";
import { horaBR, paraCampoBR } from "./data-br";

// Quarta-feira, 24/06/2026, 10h EM BRASÍLIA (13:00 UTC). Instante explícito:
// com `new Date(2026,5,24,10,0)` o próprio teste mudava de resposta conforme o
// fuso da máquina, que é justamente o defeito que estamos consertando.
const QUA = "2026-06-24T13:00:00Z";

// Lê o dia SEMPRE em Brasília — é o que a pessoa vê na tela.
const dia = (iso: string) => paraCampoBR(iso);

describe("quickDeadlineISO", () => {
  test("hoje = mesmo dia, 23h59 de Brasília", () => {
    const iso = quickDeadlineISO("hoje", QUA);
    expect(dia(iso)).toBe("2026-06-24");
    expect(horaBR(iso)).toBe("23h59");
  });

  test("amanha = +1 dia", () => {
    expect(dia(quickDeadlineISO("amanha", QUA))).toBe("2026-06-25");
  });

  test("sexta = próxima sexta (2026-06-26)", () => {
    expect(dia(quickDeadlineISO("sexta", QUA))).toBe("2026-06-26");
  });

  test("sexta a partir de uma sexta pula pra próxima", () => {
    const sex = "2026-06-26T13:00:00Z";
    expect(dia(quickDeadlineISO("sexta", sex))).toBe("2026-07-03");
  });

  test("proxsemana = próxima segunda (2026-06-29)", () => {
    expect(dia(quickDeadlineISO("proxsemana", QUA))).toBe("2026-06-29");
  });

  test("às 22h de Brasília ainda é HOJE, mesmo o servidor em UTC já sendo amanhã", () => {
    // 01:00 UTC do dia 25 = 22:00 do dia 24 aqui.
    expect(dia(quickDeadlineISO("hoje", "2026-06-25T01:00:00Z"))).toBe("2026-06-24");
  });
});

describe("allConcluidas / concluirAction", () => {
  test("vazio → false", () => {
    expect(allConcluidas([])).toBe(false);
  });

  test("todas concluídas → true e botão 'Reabrir'", () => {
    const sel = [{ status: "concluida" }, { status: "concluida" }];
    expect(allConcluidas(sel)).toBe(true);
    expect(concluirAction(sel)).toEqual({ label: "Reabrir", status: "aberta" });
  });

  test("mistura → false e botão 'Concluir'", () => {
    const sel = [{ status: "concluida" }, { status: "aberta" }];
    expect(allConcluidas(sel)).toBe(false);
    expect(concluirAction(sel)).toEqual({ label: "Concluir", status: "concluida" });
  });
});

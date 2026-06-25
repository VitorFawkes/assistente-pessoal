import { test, expect, describe } from "bun:test";
import { quickDeadlineISO, allConcluidas, concluirAction } from "./bulk";

// Quarta-feira, 2026-06-24 10:00 local.
const WED = new Date(2026, 5, 24, 10, 0, 0, 0);

function ymd(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

describe("quickDeadlineISO", () => {
  test("hoje = mesmo dia, fim do dia", () => {
    const iso = quickDeadlineISO("hoje", WED);
    expect(ymd(iso)).toBe("2026-06-24");
    expect(new Date(iso).getHours()).toBe(23);
    expect(new Date(iso).getMinutes()).toBe(59);
  });

  test("amanha = +1 dia", () => {
    expect(ymd(quickDeadlineISO("amanha", WED))).toBe("2026-06-25");
  });

  test("sexta = próxima sexta (2026-06-26)", () => {
    expect(ymd(quickDeadlineISO("sexta", WED))).toBe("2026-06-26");
  });

  test("sexta a partir de uma sexta pula pra próxima", () => {
    const fri = new Date(2026, 5, 26, 10, 0, 0, 0); // sexta
    expect(ymd(quickDeadlineISO("sexta", fri))).toBe("2026-07-03");
  });

  test("proxsemana = próxima segunda (2026-06-29)", () => {
    expect(ymd(quickDeadlineISO("proxsemana", WED))).toBe("2026-06-29");
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

import { expect, test } from "bun:test";
import { budgetReply, dailyBudgetUsd, secondsUntilNextDay } from "./budget";

test("the ceiling starts over at 00:05 of the next local day", () => {
 expect(secondsUntilNextDay("America/Sao_Paulo", new Date("2026-09-25T23:00:00-03:00"))).toBe(65 * 60);
 expect(secondsUntilNextDay("America/Sao_Paulo", new Date("2026-09-26T00:10:00-03:00"))).toBe(23 * 3600 + 55 * 60);
});
test("the daily ceiling defaults to US$ 3 and the refusal says so in reais formatting", () => {
 const previous = process.env.COACH_DAILY_BUDGET_USD;
 try {
  delete process.env.COACH_DAILY_BUDGET_USD; expect(dailyBudgetUsd()).toBe(3);
  process.env.COACH_DAILY_BUDGET_USD = "1.5"; expect(dailyBudgetUsd()).toBe(1.5);
  process.env.COACH_DAILY_BUDGET_USD = "abc"; expect(dailyBudgetUsd()).toBe(3);
  expect(budgetReply(3)).toContain("US$ 3,00 por dia");
 } finally { if (previous === undefined) delete process.env.COACH_DAILY_BUDGET_USD; else process.env.COACH_DAILY_BUDGET_USD = previous; }
});

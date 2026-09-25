import { afterEach, expect, spyOn, test } from "bun:test";
import * as agenda from "./morning-agenda";
import * as calendar from "./calendar";
import * as taskActions from "./task-actions";
import { coachModelConfig } from "./provider";
import { quickData, quickTaskAnswer } from "./quick-answer";

const originalFetch = globalThis.fetch;
const keys = ["OPENAI_API_KEY", "COACH_QUICK_MODEL", "COACH_QUICK_PROVIDER", "COACH_MODEL", "COACH_PROVIDER"] as const;
const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
afterEach(() => { globalThis.fetch = originalFetch; for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const due = { due_today: 1, overdue: 2, listed: 3, note: "A lista das 8h mostra as 3 primeiras.", items: [
 { id: "11111111-1111-4111-8111-111111111111", titulo: "Enviar proposta", owner: "vitor", acao: "executar", prazo: "2026-09-24T15:00:00.000Z", vence_hoje: false, shown_at_8h: true },
 { id: "22222222-2222-4222-8222-222222222222", titulo: "Cobrar contrato", owner: "Paula", acao: "cobrar", prazo: "2026-09-23T15:00:00.000Z", vence_hoje: false, shown_at_8h: true },
 { id: "33333333-3333-4333-8333-333333333333", titulo: "Revisar roteiro", owner: "vitor", acao: "executar", prazo: "2026-09-25T15:00:00.000Z", vence_hoje: true, shown_at_8h: true },
] };
const task = (i: number, status = "aberta") => ({ id: `4444444${i}-4444-4444-8444-444444444444`, titulo: `Tarefa ${i}`, owner: "Ana", is_mine: false, status, prazo: "2026-09-26T15:00:00.000Z", prioridade: "media", shared: false });

test("cheap lane: tasks and agenda questions use the cheap model by default, with a bounded package", () => {
 delete process.env.COACH_QUICK_MODEL; delete process.env.COACH_QUICK_PROVIDER; process.env.COACH_MODEL = "gpt-6-sol";
 expect(coachModelConfig("quick")).toEqual({ provider: "openai", model: "gpt-6-luna" });
 process.env.COACH_QUICK_MODEL = "gpt-6-sol"; expect(coachModelConfig("quick").model).toBe("gpt-6-sol");
 process.env.COACH_QUICK_MODEL = "gpt-6-astra"; expect(() => coachModelConfig("quick")).toThrow();
 const data = quickData({ message: "Quais estão atrasadas?", history: Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `m${i} ${"x".repeat(2000)}` })), notes: [], timezone: "America/Sao_Paulo", now: new Date("2026-09-25T12:00:00Z"), due, tasks: [task(1, "cancelada"), ...Array.from({ length: 60 }, (_, i) => task(i + 2))], agenda: { status: "unavailable", events: [] } });
 expect(data.agenda_today.status).toBe("unavailable");
 expect(data.recent_conversation).toHaveLength(6);
 expect(data.recent_conversation[0].text.length).toBeLessThanOrEqual(600);
 expect(data.related_tasks).toHaveLength(40);
 expect(data.related_tasks[0].status).toBe("aberta");
 expect(JSON.stringify(data)).not.toContain("1111-4111");
 expect(JSON.stringify(data).length).toBeLessThan(15000);
});

test("cheap lane: one call to the cheap model, low effort, no tools and no verifier", async () => {
 process.env.OPENAI_API_KEY = "synthetic-key"; delete process.env.COACH_QUICK_MODEL; delete process.env.COACH_QUICK_PROVIDER;
 const spies = [spyOn(agenda, "dueTasks").mockResolvedValue(due), spyOn(taskActions, "candidateTasks").mockResolvedValue([task(1)]), spyOn(calendar, "calendarContext").mockRejectedValue(new Error("calendar down"))];
 const bodies: Record<string, unknown>[] = [];
 globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  bodies.push(JSON.parse(String(init?.body)));
  return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ answer: "Estão atrasadas: Enviar proposta (24/09) e Cobrar contrato com a Paula (23/09)." }) }] }], usage: { input_tokens: 2000, output_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } });
 }) as unknown as typeof fetch;
 try {
  const telemetry: { model: string; costUsd: number }[] = [];
  const answer = await quickTaskAnswer({ userId: "owner", message: "Quais estão atrasadas?", history: [], notes: [], timezone: "America/Sao_Paulo", now: new Date("2026-09-25T12:00:00Z"), onTelemetry: e => telemetry.push(e) });
  expect(answer).toContain("Enviar proposta");
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ model: "gpt-6-luna", reasoning: { effort: "low" }, prompt_cache_options: { mode: "explicit" } });
  expect(bodies[0]).not.toHaveProperty("tools");
  const sent = JSON.parse(((bodies[0].input as { role: string; content: string }[]).find(item => item.role === "user"))!.content);
  expect(sent.agenda_today).toEqual({ status: "unavailable", events: [] });
  // 2.000 in + 100 out on GPT-6 Luna: a fraction of a cent.
  expect(telemetry[0].costUsd).toBeCloseTo((2000 * 0.1 + 100 * 0.5) / 1e6, 10);
 } finally { for (const spy of spies) spy.mockRestore(); }
});

import { afterEach, expect, spyOn, test } from "bun:test";
import * as finder from "./finder";
import * as planner from "./planner";
import { answerInfo, buildDossier, dossierForModel, proactivePlan } from "./assistant";
import type { Dossier } from "./assistant-types";

const originalFetch = globalThis.fetch;
const keys = ["OPENAI_API_KEY", "COACH_QUICK_MODEL", "COACH_QUICK_PROVIDER"] as const;
const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
afterEach(() => { globalThis.fetch = originalFetch; for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const dossier: Dossier = {
 pessoas_citadas: [{ id: "p-ana", nome: "Ana", tarefas: 117, ultima_reuniao: "2026-09-23T18:19:00.000Z" }, { id: "p-ana-t", nome: "Ana Teresa", tarefas: 14, ultima_reuniao: null }],
 reunioes_citadas: [],
 consultas: [{ consulta: "tarefas ligadas a Ana, da mais nova", tipo: "tarefas_da_pessoa", total: 9, mostrados: 1, tarefas: [{ titulo: "Definir roadmap e protótipo da nova experiência digital de Trips", owner: "Matheus", status: "aberta", prazo: null, prioridade: "alta", criada_em: "2026-09-25T01:30:00.000Z", concluida_em: null, reuniao: { titulo: "online - 20260924 2200.mp3", data: "2026-09-25T01:00:00.000Z" }, ligacao: "envolvida" }] }],
 limitacoes: [],
 excerpts: [{ meeting: { id: "m" }, chunk: { index: 0 } } as never],
};

test("check-ins plan fixed lookups; only a meeting follow-up reads that meeting", () => {
 expect(proactivePlan("morning").map(q => q.tipo)).toEqual(["pendencias", "agenda", "reunioes_do_periodo"]);
 expect(proactivePlan("evening").map(q => q.tipo)).toEqual(["agenda", "reunioes_do_periodo", "tarefas_do_periodo"]);
 expect(proactivePlan("meeting", "meeting-1")).toMatchObject([{ tipo: "detalhe_da_reuniao", reuniao: "meeting-1" }]);
 expect(proactivePlan("nudge").map(q => q.tipo)).toEqual(["pendencias"]);
});

test("the model reads dates in the user's timezone and never the transcript chunks behind passages", () => {
 const view = dossierForModel(dossier, "America/Sao_Paulo") as unknown as Record<string, unknown>;
 expect(view).not.toHaveProperty("excerpts");
 const task = (view.consultas as { tarefas: Record<string, unknown>[] }[])[0].tarefas[0];
 // 01:30 UTC on 25/09 is still 24/09 in São Paulo.
 expect(task.criada_em).toBe("24/09/2026, 22:30");
 expect((task.reuniao as Record<string, unknown>).data).toBe("24/09/2026, 22:00");
});

test("the dossier chains what the message cites, what the planner picks and what the finder runs", async () => {
 const people = dossier.pessoas_citadas;
 const spies = [
  spyOn(finder, "resolveEntities").mockResolvedValue({ people, meetings: [] }),
  spyOn(planner, "planQueries").mockResolvedValue([{ tipo: "tarefas_da_pessoa", pessoa: "p-ana", reuniao: null, busca: "", periodo: null, campo: "prazo", status: "todas", ordem: "recentes" }]),
  spyOn(finder, "runQueries").mockResolvedValue(dossier),
 ];
 try {
  const result = await buildDossier({ userId: "owner", message: "Quais foram as últimas tarefas que discuti com a Ana?", recent: [], lane: "tarefas", timezone: "America/Sao_Paulo", now: new Date("2026-09-25T15:00:00Z"), selfPersonIds: ["self"] });
  expect(planner.planQueries).toHaveBeenCalledWith(expect.objectContaining({ people, lane: "tarefas" }));
  expect(finder.resolveEntities).toHaveBeenCalledWith("owner", expect.any(String), { timezone: "America/Sao_Paulo", now: new Date("2026-09-25T15:00:00Z") });
  expect(finder.runQueries).toHaveBeenCalledWith("owner", [expect.objectContaining({ tipo: "tarefas_da_pessoa", pessoa: "p-ana" })], expect.objectContaining({ selfPersonIds: ["self"], people, meetings: [] }));
  expect(result).toBe(dossier);
 } finally { for (const spy of spies) spy.mockRestore(); }
});

test("a follow-up that cites no one uses who the previous user message cited", async () => {
 const people = dossier.pessoas_citadas;
 const resolve = spyOn(finder, "resolveEntities").mockImplementation(async (_u, text) => text.includes("Ana") ? { people, meetings: [] } : { people: [], meetings: [] });
 const spies = [resolve, spyOn(planner, "planQueries").mockResolvedValue([]), spyOn(finder, "runQueries").mockResolvedValue(dossier)];
 try {
  await buildDossier({ userId: "owner", message: "e as reuniões?", recent: [{ role: "user", content: "tarefas com a Ana" }, { role: "assistant", content: "Paula e Tiago têm..." }], lane: "tarefas", timezone: "America/Sao_Paulo", now: new Date("2026-09-25T15:00:00Z"), selfPersonIds: [] });
  expect(resolve.mock.calls.map(c => c[1])).toEqual(["e as reuniões?", "tarefas com a Ana"]);
  expect(planner.planQueries).toHaveBeenCalledWith(expect.objectContaining({ people }));
 } finally { for (const spy of spies) spy.mockRestore(); }
});

test("information answers are one call to the cheap model, with the dossier and no tools", async () => {
 process.env.OPENAI_API_KEY = "synthetic-key"; delete process.env.COACH_QUICK_MODEL; delete process.env.COACH_QUICK_PROVIDER;
 const bodies: Record<string, unknown>[] = [];
 globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  bodies.push(JSON.parse(String(init?.body)));
  return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ answer: "A mais recente com a Ana é Definir roadmap e protótipo da nova experiência digital de Trips (24/09)." }) }] }], usage: { input_tokens: 3000, output_tokens: 120, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } });
 }) as unknown as typeof fetch;
 const telemetry: { model: string; costUsd: number }[] = [];
 const answer = await answerInfo({ message: "Quais foram as últimas tarefas que discuti com a Ana?", recent: [], notes: [], dossier, timezone: "America/Sao_Paulo", now: new Date("2026-09-25T15:00:00Z"), onTelemetry: e => telemetry.push(e) });
 expect(answer).toContain("Definir roadmap");
 expect(bodies).toHaveLength(1);
 expect(bodies[0]).toMatchObject({ model: "gpt-6-luna", reasoning: { effort: "low" }, prompt_cache_options: { mode: "explicit" } });
 expect(bodies[0]).not.toHaveProperty("tools");
 const sent = JSON.stringify(bodies[0]);
 expect(sent).toContain("Definir roadmap e protótipo");
 expect(sent).toContain("Ana Teresa");
 expect(telemetry[0].costUsd).toBeCloseTo((3000 * 0.1 + 120 * 0.5) / 1e6, 10);
});

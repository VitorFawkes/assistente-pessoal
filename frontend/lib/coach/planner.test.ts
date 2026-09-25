import { afterEach, expect, test } from "bun:test";
import { plannerSchema, PLANNER_INSTRUCTION, planQueries, defaultPlan } from "./planner";
import { validCoachSchema } from "./provider-schema";
import { type CoachTelemetry } from "./provider";
import type { PersonCandidate, MeetingCandidate } from "./assistant-types";

const originalFetch = globalThis.fetch;
const keys = ["OPENAI_API_KEY", "COACH_QUICK_MODEL", "COACH_QUICK_PROVIDER", "COACH_MODEL", "COACH_PROVIDER"] as const;
const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
afterEach(() => {
 globalThis.fetch = originalFetch;
 for (const k of keys) {
  if (saved[k] === undefined) delete process.env[k];
  else process.env[k] = saved[k];
 }
});

const people: PersonCandidate[] = [
 { id: "p1-uuid", nome: "Ana", tarefas: 5, ultima_reuniao: "2026-09-24T10:00:00.000Z" },
 { id: "p2-uuid", nome: "Bruno", tarefas: 3, ultima_reuniao: "2026-09-23T14:00:00.000Z" },
];

const meetings: MeetingCandidate[] = [
 { id: "m1-uuid", titulo: "Planejamento trimestral", recorded_at: "2026-09-24T09:00:00.000Z" },
 { id: "m2-uuid", titulo: "Retrospectiva", recorded_at: "2026-09-23T15:00:00.000Z" },
];

test("schema passes validCoachSchema and has no control characters in enums", () => {
 const schema = plannerSchema(people, meetings);
 expect(validCoachSchema(schema)).toBe(true);

 // Check enums for control characters
 const checkEnums = (obj: unknown): void => {
  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
   const record = obj as Record<string, unknown>;
   if (Array.isArray(record.enum)) {
    for (const val of record.enum) {
     if (typeof val === "string") {
      // No control characters (0x00-0x1F, 0x7F)
      for (let i = 0; i < val.length; i++) {
       const code = val.charCodeAt(i);
       expect(code >= 0x20 && code !== 0x7f).toBe(true);
      }
     }
    }
   }
   for (const value of Object.values(record)) checkEnums(value);
  } else if (Array.isArray(obj)) {
   for (const item of obj) checkEnums(item);
  }
 };
 checkEnums(schema);
});

test("schema has person and meeting refs only, no real names", () => {
 const schema = plannerSchema(people, meetings);
 const schemaStr = JSON.stringify(schema);
 expect(schemaStr).not.toContain("Ana");
 expect(schemaStr).not.toContain("Bruno");
 expect(schemaStr).not.toContain("Planejamento");
 expect(schemaStr).toContain("p0");
 expect(schemaStr).toContain("r0");
});

test("refs are converted to ids", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;
 delete process.env.COACH_QUICK_PROVIDER;

 const bodies: Record<string, unknown>[] = [];
 globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  bodies.push(JSON.parse(String(init?.body)));
  return Response.json({
   status: "completed",
   output: [
    {
     type: "message",
     content: [
      {
       type: "output_text",
       text: JSON.stringify({
        consultas: [
         {
          tipo: "tarefas_da_pessoa",
          pessoa: "p0",
          reuniao: "",
          busca: "",
          periodo: "",
          campo: "prazo",
          status: "abertas",
          ordem: "recentes",
         },
        ],
       }),
      },
     ],
    },
   ],
   usage: { input_tokens: 100, output_tokens: 50 },
  });
 }) as unknown as typeof fetch;

 const planned = await planQueries({
  message: "o que Ana está fazendo",
  recent: [],
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
 });

 expect(planned).toHaveLength(1);
 expect(planned[0].pessoa).toBe("p1-uuid");
 expect(planned[0].tipo).toBe("tarefas_da_pessoa");
});

test("queries without required params are dropped", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;

 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  return Response.json({
   status: "completed",
   output: [
    {
     type: "message",
     content: [
      {
       type: "output_text",
       text: JSON.stringify({
        consultas: [
         {
          tipo: "tarefas_da_pessoa",
          pessoa: "",
          reuniao: "",
          busca: "",
          periodo: "",
          campo: "prazo",
          status: "abertas",
          ordem: "recentes",
         },
         {
          tipo: "tarefas_por_assunto",
          pessoa: "",
          reuniao: "",
          busca: "marketing",
          periodo: "",
          campo: "prazo",
          status: "abertas",
          ordem: "recentes",
         },
        ],
       }),
      },
     ],
    },
   ],
   usage: { input_tokens: 100, output_tokens: 50 },
  });
 }) as unknown as typeof fetch;

 const planned = await planQueries({
  message: "show me",
  recent: [],
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
 });

 // First query dropped (no pessoa), second kept
 expect(planned).toHaveLength(1);
 expect(planned[0].tipo).toBe("tarefas_por_assunto");
 expect(planned[0].busca).toBe("marketing");
});

test("duplicate queries are removed", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;

 globalThis.fetch = (async () => {
  return Response.json({
   status: "completed",
   output: [
    {
     type: "message",
     content: [
      {
       type: "output_text",
       text: JSON.stringify({
        consultas: [
         {
          tipo: "tarefas_da_pessoa",
          pessoa: "p0",
          reuniao: "",
          busca: "",
          periodo: "",
          campo: "prazo",
          status: "abertas",
          ordem: "recentes",
         },
         {
          tipo: "tarefas_da_pessoa",
          pessoa: "p0",
          reuniao: "",
          busca: "",
          periodo: "",
          campo: "prazo",
          status: "abertas",
          ordem: "recentes",
         },
        ],
       }),
      },
     ],
    },
   ],
   usage: { input_tokens: 100, output_tokens: 50 },
  });
 }) as unknown as typeof fetch;

 const planned = await planQueries({
  message: "test",
  recent: [],
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
 });

 expect(planned).toHaveLength(1);
});

test("more than 4 queries are truncated", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;

 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 globalThis.fetch = (async (_url: unknown, _init?: RequestInit) => {
  return Response.json({
   status: "completed",
   output: [
    {
     type: "message",
     content: [
      {
       type: "output_text",
       text: JSON.stringify({
        consultas: Array.from({ length: 10 }, (_, i) => ({
         tipo: "pendencias",
         pessoa: "",
         reuniao: "",
         busca: `search${i}`,
         periodo: "",
         campo: "prazo",
         status: "abertas",
         ordem: "recentes",
        })),
       }),
      },
     ],
    },
   ],
   usage: { input_tokens: 100, output_tokens: 50 },
  });
 }) as unknown as typeof fetch;

 const planned = await planQueries({
  message: "test",
  recent: [],
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
 });

 expect(planned.length).toBeLessThanOrEqual(4);
});

test("provider error falls back to defaultPlan", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;

 globalThis.fetch = (async () => {
  throw new Error("Network error");
 }) as unknown as typeof fetch;

 const planned = await planQueries({
  message: "o que Ana está fazendo",
  recent: [],
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
 });

 expect(planned.map(q => q.tipo)).toEqual(["detalhe_da_reuniao"]);
});

test("empty list in tarefas lane uses defaultPlan", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;

 globalThis.fetch = (async () => {
  return Response.json({
   status: "completed",
   output: [
    {
     type: "message",
     content: [
      {
       type: "output_text",
       text: JSON.stringify({ consultas: [] }),
      },
     ],
    },
   ],
   usage: { input_tokens: 100, output_tokens: 50 },
  });
 }) as unknown as typeof fetch;

 const planned = await planQueries({
  message: "o que Ana está fazendo",
  recent: [],
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
 });
 expect(planned.map(q => q.tipo)).toEqual(["detalhe_da_reuniao"]);
 const coach = await planQueries({ message: "obrigado", recent: [], people, meetings, lane: "coach", timezone: "UTC", now: new Date() });
 expect(coach).toEqual([]);
});

test("calls cheap model (gpt-6-luna) with low effort and no tools", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;
 delete process.env.COACH_QUICK_PROVIDER;

 const bodies: Record<string, unknown>[] = [];
 globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  bodies.push(JSON.parse(String(init?.body)));
  return Response.json({
   status: "completed",
   output: [
    {
     type: "message",
     content: [{ type: "output_text", text: JSON.stringify({ consultas: [] }) }],
    },
   ],
   usage: { input_tokens: 100, output_tokens: 50 },
  });
 }) as unknown as typeof fetch;

 await planQueries({
  message: "test",
  recent: [],
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
 });

 expect(bodies).toHaveLength(1);
 expect(bodies[0].model).toBe("gpt-6-luna");
 expect(bodies[0].reasoning).toEqual({ effort: "low" });
 expect(bodies[0]).not.toHaveProperty("tools");
});

test("calls onTelemetry callback", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;

 globalThis.fetch = (async () => {
  return Response.json({
   status: "completed",
   output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ consultas: [] }) }] }],
   usage: { input_tokens: 100, output_tokens: 50 },
  });
 }) as unknown as typeof fetch;

 const telemetry: CoachTelemetry[] = [];
 await planQueries({
  message: "test",
  recent: [],
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
  onTelemetry: e => telemetry.push(e),
 });

 expect(telemetry.length).toBeGreaterThan(0);
 expect(telemetry[0].model).toBe("gpt-6-luna");
});

test("fallback: the cited meeting, else the cited person, else today's list (information only)", () => {
 expect(defaultPlan(people, meetings, "tarefas").map(q => [q.tipo, q.reuniao])).toEqual([["detalhe_da_reuniao", "m1-uuid"]]);
 expect(defaultPlan(people, [], "coach").map(q => [q.tipo, q.pessoa, q.status, q.ordem])).toEqual([["tarefas_da_pessoa", "p1-uuid", "todas", "recentes"], ["reunioes_da_pessoa", "p1-uuid", "abertas", "prazo"]]);
 expect(defaultPlan([], [], "tarefas").map(q => q.tipo)).toEqual(["pendencias"]);
 expect(defaultPlan([], [], "coach")).toEqual([]);
});

test("message truncated to 1000 chars in data sent to model", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;

 const bodies: Record<string, unknown>[] = [];
 globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  bodies.push(JSON.parse(String(init?.body)));
  return Response.json({
   status: "completed",
   output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ consultas: [] }) }] }],
   usage: { input_tokens: 100, output_tokens: 50 },
  });
 }) as unknown as typeof fetch;

 const longMessage = "x".repeat(2000);
 await planQueries({
  message: longMessage,
  recent: [],
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
 });

 const sent = JSON.parse(((bodies[0].input as { role: string; content: string }[]).find(item => item.role === "user")!).content);
 expect(sent.mensagem.length).toBeLessThanOrEqual(1000);
});

test("recent conversation limited to last 4 items and clipped to 400 chars each", async () => {
 process.env.OPENAI_API_KEY = "test-key";
 delete process.env.COACH_QUICK_MODEL;

 const bodies: Record<string, unknown>[] = [];
 globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  bodies.push(JSON.parse(String(init?.body)));
  return Response.json({
   status: "completed",
   output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ consultas: [] }) }] }],
   usage: { input_tokens: 100, output_tokens: 50 },
  });
 }) as unknown as typeof fetch;

 const recent = Array.from({ length: 10 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: "a".repeat(1000),
 }));

 await planQueries({
  message: "test",
  recent,
  people,
  meetings,
  lane: "tarefas",
  timezone: "UTC",
  now: new Date(),
 });

 const sent = JSON.parse(((bodies[0].input as { role: string; content: string }[]).find(item => item.role === "user")!).content);
 expect(sent.conversa_recente).toHaveLength(4);
 expect(sent.conversa_recente[0].conteudo.length).toBeLessThanOrEqual(400);
});

test("the instruction names every lookup the finder runs", () => {
 for (const kind of ["tarefas_da_pessoa", "tarefas_por_assunto", "tarefas_do_periodo", "pendencias", "reunioes_da_pessoa", "reunioes_por_assunto", "reunioes_do_periodo", "detalhe_da_reuniao", "trechos", "agenda", "conversas"])
  expect(PLANNER_INSTRUCTION).toContain(`- ${kind}`);
});

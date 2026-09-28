import { describe, expect, test } from "bun:test";
import { countsLine, emptyFilter, filterProperties, filterWords, hasCriterion, nameMatcher, readFilter, type FilterContext, type TaskFilter } from "./task-filter";

const SP = "America/Sao_Paulo";
const now = new Date("2026-09-28T15:00:00Z"); // segunda, 12h em São Paulo
const ctx: FilterContext = {
 boards: [{ code: "q1", id: "board-mkt", nome: "Mkt Performance + Consultoria" }, { code: "q2", id: "board-ww", nome: "WW - MKT & Vendas" }],
 areas: [{ code: "a1", nome: "Marketing" }, { code: "a2", nome: "TikTok" }],
 meetings: [{ code: "r1", id: "meeting-paula", titulo: "Reunião com a Paula", data: "2026-09-25T13:00:00.000Z", participantes: ["Paula"] }],
};
const tasks = new Map([["t1", { id: "task-agente" }], ["t2", { id: "task-proposta" }]]);
const raw = (r: Partial<Record<keyof TaskFilter, unknown>>) => ({ ...Object.fromEntries(Object.entries(emptyFilter()).map(([k, v]) => [k, v === null ? "" : v])), ...r });
const read = (r: Partial<Record<keyof TaskFilter, unknown>>) => readFilter(raw(r), ctx, tasks, SP, now);
const words = (r: Partial<Record<keyof TaskFilter, unknown>>) => filterWords(read(r)!, ctx, SP, now);

describe("todos os jeitos de dizer quais tarefas", () => {
 test("sem prazo, com prazo, atrasadas, até uma data, um dia, um intervalo", () => {
  expect(words({ due: "none" })).toBe("sem prazo");
  expect(words({ due: "any" })).toBe("com prazo");
  expect(words({ due: "range", due_until: "2026-09-27" })).toBe("atrasadas");
  expect(words({ due: "range", due_until: "2026-09-24" })).toBe("com prazo até 24/09");
  expect(words({ due: "range", due_from: "2026-09-28", due_until: "2026-09-28" })).toBe("com prazo em 28/09");
  expect(words({ due: "range", due_from: "2026-07-01", due_until: "2026-07-31" })).toBe("com prazo de 01/07 a 31/07");
  expect(words({ due: "range", due_from: "2026-10-01" })).toBe("com prazo a partir de 01/10");
 });
 test("de quem: suas, de outras pessoas, sem responsável, de fulano ou sicrano, menos as de alguém", () => {
  expect(words({ who: "me" })).toBe("suas");
  expect(words({ who: "others" })).toBe("de outras pessoas");
  expect(words({ who: "nobody" })).toBe("sem responsável");
  expect(words({ people: ["Tiago", "Paula"] })).toBe("de Tiago ou Paula");
  expect(words({ all: true, not_people: ["Tiago"] })).toBe("abertas, menos as de Tiago");
  expect(words({ kind: "chase" })).toBe("para você cobrar");
  expect(words({ kind: "wait" })).toBe("que você está aguardando");
 });
 test("o próprio nome do usuário vira 'suas', nunca um grupo que só o inclui", () => {
  expect(read({ people: ["Vitor"] })).toMatchObject({ people: [], who: "me" });
  expect(read({ people: ["eu"] })).toMatchObject({ people: [], who: "me" });
  expect(read({ people: ["Tiago e Vitor"] })).toMatchObject({ people: ["Tiago e Vitor"], who: "" });
 });
 test("prioridade, quadro, área, reunião, origem, assunto, criação, conclusão, paradas, repetidas", () => {
  expect(words({ priorities: ["urgente", "alta"] })).toBe("de prioridade urgente ou alta");
  expect(words({ boards: ["q1"] })).toBe('do quadro "Mkt Performance + Consultoria"');
  expect(words({ areas: ["a1"] })).toBe('da área "Marketing"');
  expect(words({ areas: ["sem_area"] })).toBe("sem área");
  expect(words({ meetings: ["r1"] })).toBe('da reunião "Reunião com a Paula" (25/09)');
  expect(words({ meeting_from: "2026-09-21", meeting_until: "2026-09-25" })).toBe("de reuniões de 21/09 a 25/09");
  expect(words({ source: "manual" })).toBe("criadas à mão");
  expect(words({ words: ["site"] })).toBe('sobre "site"');
  expect(words({ all: true, not_words: ["tiktok"] })).toBe('abertas, menos as sobre "tiktok"');
  expect(words({ created_until: "2026-07-31" })).toBe("criadas até 31/07");
  expect(words({ status: "done", closed_from: "2026-09-28", closed_until: "2026-09-28" })).toBe("concluídas em 28/09");
  expect(words({ idle_days: 30 })).toBe("paradas há mais de 30 dias");
  expect(words({ repeated: true })).toBe("marcadas como possível repetição");
 });
 test("vários critérios juntos e exceções citadas pelo nome", () => {
  expect(words({ due: "none", people: ["Tiago"], boards: ["q2"] })).toBe('sem prazo, de Tiago, do quadro "WW - MKT & Vendas"');
  expect(filterWords(read({ due: "none", except: ["t1"] })!, ctx, SP, now, ["Agente de gravação"])).toBe('sem prazo, menos "Agente de gravação"');
 });
 test("'todas' sem mais nada precisa ser dito; sem critério nenhum não vale", () => {
  expect(read({})).toBeNull();
  expect(read({ all: true })).toMatchObject({ all: true });
  expect(words({ all: true })).toBe("abertas");
  expect(hasCriterion({ ...emptyFilter(), status: "done" })).toBe(true);
 });
 test("código que não está na lista ou data impossível derruba o pedido inteiro (nunca vira 'todas')", () => {
  expect(read({ boards: ["q9"] })).toBeNull();
  expect(read({ due: "none", except: ["t9"] })).toBeNull();
  expect(read({ due: "range" })).toBeNull();
  expect(read({ due: "range", due_from: "2026-09-30", due_until: "2026-09-01" })).toBeNull();
  expect(read({ due: "sem" })).toBeNull();
  expect(read({ due: "range", due_until: "24/09" })).toBeNull();
  expect(read({ created_from: "2027-01-01" })).toBeNull();
 });
 test("exceções e códigos viram ids do servidor", () => {
  expect(read({ due: "none", except: ["t1", "t2"], boards: ["q1"], meetings: ["r1"] })).toMatchObject({ except: ["task-agente", "task-proposta"], boards: ["board-mkt"], meetings: ["meeting-paula"] });
 });
});

describe("nomes: como o Coach sempre achou, mais os apelidos do cadastro", () => {
 const pessoas = [{ nome: "Tiago", aliases: ["Ti", "Thiago"], is_vitor: false }, { nome: "Ana Teresa", aliases: [], is_vitor: false }];
 test("primeiro nome acha o dono com essa palavra; apelido do cadastro também conta", () => {
  const tiago = nameMatcher(["Tiago"], pessoas);
  expect(tiago("Tiago")).toBe(true);
  expect(tiago("Thiago")).toBe(true);
  expect(tiago("Fernanda + Júlia + Tiago")).toBe(true);
  expect(tiago("Equipe de TI")).toBe(false);
  expect(tiago("Diana")).toBe(false);
  expect(nameMatcher(["mariana"], [])("Jane e Mariana")).toBe(true);
  expect(nameMatcher(["Ana Teresa"], pessoas)("Ana Teresa")).toBe(true);
  expect(nameMatcher(["Ana Teresa"], pessoas)("Ana Paula")).toBe(false);
 });
});

test("a linha de contagem só aparece quando mistura tipos", () => {
 expect(countsLine({ suas: 77, cobrar: 63, aguardando: 14 })).toBe("São 77 suas, 63 para você cobrar e 14 que você está aguardando.");
 expect(countsLine({ suas: 5, cobrar: 0, aguardando: 0 })).toBe("");
 expect(countsLine({ suas: 1, cobrar: 1, aguardando: 0 })).toBe("São 1 sua e 1 para você cobrar.");
});

test("o formato pedido ao modelo só deixa citar quadros, áreas, reuniões e tarefas da lista", () => {
 const p = filterProperties(ctx, ["t1", "t2"]) as Record<string, { items?: { enum?: string[] } }>;
 expect(p.boards.items!.enum).toEqual(["q1", "q2"]);
 expect(p.areas.items!.enum).toEqual(["a1", "a2", "sem_area"]);
 expect(p.meetings.items!.enum).toEqual(["r1"]);
 expect(p.except.items!.enum).toEqual(["t1", "t2"]);
 const empty = filterProperties({ boards: [], areas: [], meetings: [] }, []) as Record<string, { items?: { enum?: string[] } }>;
 expect(empty.boards.items!.enum).toEqual([""]);
});

import { expect, test } from "bun:test";
import { modelEvents, modelMessages, modelRetrieved, modelReviews, modelTasks, queryFirst, slimForModel, MODEL_CONTEXT } from "./context-budget";
import type { CoachMessage, CoachReview } from "./types";
import type { CoachTask } from "./task-context";

const hash = "a".repeat(64);
const message = (i: number, role: "user" | "assistant"): CoachMessage => ({
 id: `m${i}`, role, created_at: `2026-09-2${i % 5}T12:00:00.000Z`, evidence: [], context_freshness: "current", context_version: 2,
 context_sources: Array.from({ length: 30 }, (_, j) => ({ meeting_id: `meeting-${j}`, context_hash: hash })),
 content: role === "assistant" ? `**Orientação**\n\nResposta ${i} ${"x".repeat(3000)}\n\nSem observações verificadas sobre sua conduta nas reuniões.\n\n*Não consultei trechos de reuniões nesta resposta.*` : `Pergunta ${i}`,
});

test("the model reads the last messages without lineage hashes or the presentation footer", () => {
 const history = Array.from({ length: 24 }, (_, i) => message(i, i % 2 ? "assistant" : "user"));
 const sent = modelMessages(history, MODEL_CONTEXT.history, MODEL_CONTEXT.historyChars);
 expect(sent).toHaveLength(12);
 expect(sent[0].content).toBe("Pergunta 12");
 expect(sent[1].content.startsWith("Resposta 13")).toBe(true);
 expect(sent[1].content.length).toBeLessThanOrEqual(MODEL_CONTEXT.historyChars);
 expect(JSON.stringify(sent)).not.toContain(hash);
 expect(JSON.stringify(sent)).not.toContain("Sem observações verificadas");
});

test("retrieved messages already in the recent history are not sent twice", () => {
 const history = [message(1, "user"), message(2, "assistant")];
 const retrieved = [message(2, "assistant"), message(7, "user"), message(8, "user")];
 expect(modelRetrieved(retrieved, history).map(m => m.content)).toEqual(["Pergunta 7", "Pergunta 8"]);
});

test("tasks, events and reviews keep what helps the answer, within their limits", () => {
 const task = (i: number) => ({ id: `t${i}`, titulo: `Tarefa ${i}`, descricao: "d".repeat(3000), owner: "Ana", is_mine: false, acao: "cobrar", status: "aberta", prioridade: "alta", prazo: "2026-09-28T15:00:00.000Z", meeting_id: null, frente: null, concluida_em: null, cancelada_em: null, created_at: "2026-09-01T12:00:00.000Z", updated_at: "2026-09-20T12:00:00.000Z", context_reasons: ["open_priority"], frentes: [{ id: "f", nome: "Comercial" }] }) as unknown as CoachTask;
 const tasks = modelTasks(Array.from({ length: 64 }, (_, i) => task(i)));
 expect(tasks).toHaveLength(MODEL_CONTEXT.tasks);
 expect(tasks[0]).toMatchObject({ id: "t0", titulo: "Tarefa 0", frentes: ["Comercial"], prazo: "2026-09-28T15:00:00.000Z" });
 expect(tasks[0].descricao!.length).toBeLessThanOrEqual(MODEL_CONTEXT.taskDescriptionChars);
 expect(tasks[0]).not.toHaveProperty("created_at");
 const events = modelEvents(Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, tarefa_id: "t0", tarefa_titulo: "Tarefa 0", evento: "cancelada", payload: { lote: "faxina", pedido: "p".repeat(900) }, created_at: "2026-09-24T21:43:37.469Z" })));
 expect(events).toHaveLength(MODEL_CONTEXT.events);
 expect(events[0].detalhe!.length).toBeLessThanOrEqual(MODEL_CONTEXT.eventPayloadChars);
 const review = { id: "r", week_start: "2026-09-18", model: "m", created_at: "2026-09-18T20:00:00Z", content: { headline: "Foco", focus: "f".repeat(5000), observations: [{ evidence: [{ quote: "q", source_hash: hash }] }], progress: "p", experiment: "e", question: "q", limitations: ["l".repeat(3000)], context_sources: [{ meeting_id: "x", context_hash: hash }] } } as unknown as CoachReview;
 const reviews = modelReviews([review, review, review]);
 expect(reviews).toHaveLength(1);
 expect(JSON.stringify(reviews)).not.toContain(hash);
 expect(reviews[0].focus.length).toBeLessThanOrEqual(MODEL_CONTEXT.reviewFieldChars);
});

test("the last pass drops bookkeeping and the UTC copy of dates, but keeps now and period bounds", () => {
 const slim = slimForModel({
  current_time: "2026-09-25T12:00:00.000Z", current_time_local: "25/09/2026, 09:00:00",
  context_selection: { period: { from: "2026-09-25T03:00:00.000Z", from_local: "25/09/2026, 00:00:00", to: "2026-09-26T03:00:00.000Z", to_local: "26/09/2026, 00:00:00" } },
  tasks: [{ titulo: "T", prazo: "2026-09-28T15:00:00.000Z", prazo_local: "28/09/2026, 12:00:00", updated_at: "2026-09-20T12:00:00.000Z", updated_at_local: "20/09/2026, 09:00:00" }],
  memory: { active_goals: [{ id: "g", user_id: "u", content_hash: hash, content: "Meta" }] },
  meeting_reports: [{ meeting_id: "m", context_hash: hash, recorded_at: "2026-09-24T13:00:00.000Z", recorded_at_local: "24/09/2026, 10:00:00", report: "R" }],
 }) as { current_time: string; context_selection: { period: Record<string, string> }; tasks: Record<string, string>[]; memory: { active_goals: Record<string, string>[] }; meeting_reports: Record<string, string>[] };
 expect(slim.current_time).toBe("2026-09-25T12:00:00.000Z");
 expect(slim.context_selection.period).toMatchObject({ from: "2026-09-25T03:00:00.000Z", to: "2026-09-26T03:00:00.000Z" });
 expect(slim.tasks[0]).toEqual({ titulo: "T", prazo_local: "28/09/2026, 12:00:00", updated_at_local: "20/09/2026, 09:00:00" });
 expect(slim.memory.active_goals[0]).toEqual({ id: "g", content: "Meta" });
 expect(slim.meeting_reports[0]).toEqual({ meeting_id: "m", recorded_at_local: "24/09/2026, 10:00:00", report: "R" });
});

test("a task read puts the tasks that match its query before the open priorities", () => {
 const t = (id: string, reasons: string[]) => ({ id, context_reasons: reasons }) as unknown as CoachTask;
 expect(queryFirst([t("p1", ["open_priority"]), t("q1", ["query_match"]), t("p2", ["open_priority", "query_match"]), t("r1", ["recent_activity"])]).map(x => x.id)).toEqual(["q1", "p2", "p1", "r1"]);
});

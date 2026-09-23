import { expect, test } from "bun:test";
import { commitmentsDueForFollowup, meetingMentionsCommitment } from "./follow-up";
import type { CoachCommitment } from "./types";

const now = new Date("2026-09-21T17:00:00Z");
const agreement = (patch: Partial<CoachCommitment> = {}): CoachCommitment => ({
  id: "proposal", user_id: "owner", tarefa_id: null, source_message_id: "message",
  idempotency_key: "track:message:0", title: "Enviar proposta", status: "open",
  due_at: "2026-09-21T16:00:00Z", outcome: null, outcome_source: "unknown", history: [],
  created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z", ...patch,
});

test("accepted agreements become follow-up candidates without a meeting or task", () => {
  expect(commitmentsDueForFollowup([agreement()], now).map(c => c.id)).toEqual(["proposal"]);
});
test("completed, cancelled, unknown and future or undated agreements do not trigger a nudge", () => {
  expect(commitmentsDueForFollowup([
    agreement({ status: "completed" }), agreement({ status: "cancelled" }), agreement({ status: "unknown" }),
    agreement({ due_at: null }), agreement({ due_at: "invalid" }), agreement({ due_at: "2026-09-21T18:00:00Z" }),
  ], now)).toEqual([]);
});
test("a recent obstacle or progress report is not immediately asked again", () => {
  expect(commitmentsDueForFollowup([agreement({ outcome: "Faltou o preço", updated_at: "2026-09-21T16:00:00Z" })], now)).toEqual([]);
  expect(commitmentsDueForFollowup([agreement({ outcome: "Faltou o preço", updated_at: "2026-09-21T13:00:00Z" })], now)).toHaveLength(1);
});
test("renegotiated agreements use the new deadline and the earliest due agreement comes first", () => {
  expect(commitmentsDueForFollowup([
    agreement({ id: "later", status: "renegotiated", due_at: "2026-09-22T16:00:00Z" }),
    agreement(), agreement({ id: "earlier", due_at: "2026-09-20T16:00:00Z" }),
  ], now).map(c => c.id)).toEqual(["earlier", "proposal"]);
});

test("review context changes for a new obstacle, goal or user reply, but not generated coaching text",async()=>{
  const { accountabilityFingerprint }=await import("./follow-up");
  const base=accountabilityFingerprint([agreement()],[],[]);
  expect(accountabilityFingerprint([agreement({outcome:"Faltou o preço"})],[],[])).not.toBe(base);
  expect(accountabilityFingerprint([agreement()],[],[{id:"reply",role:"user",content:"Consegui enviar",created_at:"2026-09-21T16:00:00Z",evidence:[]}])).not.toBe(base);
  expect(accountabilityFingerprint([agreement()],[],[{id:"coach",role:"assistant",content:"Retome a proposta",created_at:"2026-09-21T16:00:00Z",evidence:[]}])).toBe(base);
  expect(accountabilityFingerprint([agreement()],[{id:"goal",kind:"goal",content:"Concluir proposta",status:"confirmed",updated_at:"2026-09-21T12:00:00Z"} as never],[])).not.toBe(base);
});

test("a meeting relates to an agreement by the step's own words, not its time or place lead-in", () => {
  const closer = "Amanhã no Pensar Estratégico eu vou destravar a contratação da closer.";
  expect(meetingMentionsCommitment("Mapeamento de candidatas para a vaga de closer com a consultoria.", closer)).toBe(true);
  expect(meetingMentionsCommitment("A consultoria enviou a shortlist de closers.", closer)).toBe(true);
  expect(meetingMentionsCommitment("Decidimos contratar a nova pessoa até outubro.", closer)).toBe(true);
  expect(meetingMentionsCommitment("Revisamos o orçamento de marketing e a contraproposta do fornecedor.", closer)).toBe(false);
  expect(meetingMentionsCommitment("Planejamento estratégico de marketing; pensar nas metas do trimestre.", closer)).toBe(false);
  expect(meetingMentionsCommitment("A contratação da vaga comercial avançou.", closer)).toBe(true);
  expect(meetingMentionsCommitment("As propostas da Aurora foram aprovadas.", "Vou enviar a proposta da Aurora hoje.")).toBe(true);
  expect(meetingMentionsCommitment("Reunião geral do time.", "Vou fazer isso.")).toBe(false);
});

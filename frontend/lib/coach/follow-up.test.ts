import { expect, test } from "bun:test";
import { commitmentsDueForFollowup } from "./follow-up";
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

import { afterEach, expect, spyOn, test } from "bun:test";
import * as db from "./db";
import { coachAgent, openAiCall, openAiTranscription, recordAiUsage, tokenUsage, withUsageContext } from "./ai-usage";
import { audioCostUsd, requestCostUsd } from "./coach/pricing";

const spies: { mockRestore(): void }[] = [];
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

test("usage from Chat Completions, Responses and Embeddings replies, including the cache", () => {
 expect(tokenUsage({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 400 } })).toEqual({ inputTokens: 1000, cachedTokens: 400, cacheWriteTokens: 0, outputTokens: 50 });
 expect(tokenUsage({ input_tokens: 10312, output_tokens: 5354, input_tokens_details: { cached_tokens: 10309, cache_write_tokens: 0 } })).toEqual({ inputTokens: 10312, cachedTokens: 10309, cacheWriteTokens: 0, outputTokens: 5354 });
 expect(tokenUsage({ prompt_tokens: 7, total_tokens: 7 })).toEqual({ inputTokens: 7, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
 expect(tokenUsage(undefined)).toBeNull();
 expect(tokenUsage({ type: "duration", seconds: 3 })).toBeNull();
});

test("a call is priced from what the reply reported; a reply without usage is noted, never invented", () => {
 const measured = openAiCall("gpt-6-luna", { input_tokens: 10312, output_tokens: 5354, input_tokens_details: { cached_tokens: 10309 } });
 // The report flow in n8n computes the same value for this call.
 expect(measured.costUsd).toBeCloseTo((3 * 0.1 + 10309 * 0.01 + 5354 * 0.5) / 1e6, 12);
 expect(measured.basis).toBe("medido");
 expect(openAiCall("text-embedding-3-small", { prompt_tokens: 1_000_000 }).costUsd).toBeCloseTo(0.02, 10);
 expect(openAiCall("gpt-6-sol", null)).toMatchObject({ costUsd: 0, basis: "estimado", note: "A resposta não informou o consumo." });
});

test("audio is billed by length: gpt-transcribe per minute, AssemblyAI per hour plus diarization", () => {
 expect(openAiTranscription("gpt-transcribe", { type: "duration", seconds: 120 })).toMatchObject({ audioSeconds: 120, costUsd: 0.009, basis: "medido" });
 expect(openAiTranscription("gpt-transcribe", {})).toMatchObject({ costUsd: 0, basis: "estimado" });
 expect(audioCostUsd("assemblyai", "universal-3-5-pro", 3600, true)).toBeCloseTo(0.23, 10);
 expect(audioCostUsd("assemblyai", "universal-2", 3600)).toBeCloseTo(0.15, 10);
 expect(requestCostUsd("gpt-6-sol", { inputTokens: 300_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 1000 })).toBeCloseTo((300_000 * 4 + 1000 * 15) / 1e6, 10);
});

test("Coach purposes map to agents; scheduled check-ins are their own agent", () => {
 expect(["chat", "checkin_morning", "checkin_meeting", "quick", "tasks", "weekly", "analysis", "embedding", "nova"].map(coachAgent))
  .toEqual(["coach_conversa", "coach_mensagens", "coach_mensagens", "coach_assistente", "coach_leitor", "coach_revisao", "coach_analise", "coach_busca", "coach_outros"]);
});

test("a call made inside a person's request is recorded for that person and meeting, once per ref", async () => {
 const writes: unknown[][] = [];
 spies.push(spyOn(db, "query").mockImplementation((async (_sql: string, values: unknown[] = []) => { writes.push(values); return writes.length === 1 ? [{ id: "x" }] : []; }) as typeof db.query));
 const user = "7740e829-9462-416b-81a1-b787e23ba9b2", meeting = "060bf468-d251-4227-967a-65341879b125";
 const first = await withUsageContext({ userId: user, meetingId: meeting }, () => recordAiUsage({ ref: "r1", agent: "ditado", source: "app", ...openAiCall("gpt-6-luna", { prompt_tokens: 10, completion_tokens: 2 }) }));
 const replay = await recordAiUsage({ ref: "r1", agent: "ditado", source: "app", userId: "not-a-uuid", ...openAiCall("gpt-6-luna", { prompt_tokens: 10, completion_tokens: 2 }) });
 expect([first, replay]).toEqual([true, false]);
 expect(writes[0].slice(0, 7)).toEqual(["r1", user, meeting, "ditado", "openai", "gpt-6-luna", "app"]);
 expect(writes[1][1]).toBeNull();
});

test("recording never breaks the feature, except for a reader that asked to be told", async () => {
 spies.push(spyOn(db, "query").mockRejectedValue(new Error("db down")));
 spies.push(spyOn(console, "error").mockImplementation(() => {}));
 const entry = { ref: "r2", agent: "ditado" as const, source: "app" as const, provider: "openai", model: "gpt-6-luna", costUsd: 0.001, basis: "medido" as const };
 expect(await recordAiUsage(entry)).toBe(false);
 await expect(recordAiUsage(entry, { strict: true })).rejects.toThrow("db down");
});

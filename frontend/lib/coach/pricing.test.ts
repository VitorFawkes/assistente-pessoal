import { expect, test } from "bun:test";
import { requestCostUsd } from "./pricing";

test("a request pays each input token at its own rate: ordinary, read from cache or written to it", () => {
 // 10k ordinary, 4k cached, 6k written, 1k output on GPT-6 Sol (US$ 2 / 0,20 / 2,50 / 10 per 1M).
 expect(requestCostUsd("gpt-6-sol", { inputTokens: 20_000, cachedTokens: 4_000, cacheWriteTokens: 6_000, outputTokens: 1_000 })).toBeCloseTo(0.02 + 0.0008 + 0.015 + 0.01, 10);
 expect(requestCostUsd("gpt-6-luna", { inputTokens: 200_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })).toBeCloseTo(0.02, 10);
});
test("above 272k input tokens the whole request costs 2× input and 1.5× output", () => {
 expect(requestCostUsd("gpt-6-sol", { inputTokens: 300_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000 })).toBeCloseTo(300_000 * 4 / 1e6 + 1_000 * 15 / 1e6, 10);
});
test("a model without a checked price never counts as cheaper than the ones in use", () => {
 const usage = { inputTokens: 10_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000 };
 expect(requestCostUsd("claude-opus-5", usage)).toBeGreaterThanOrEqual(requestCostUsd("gpt-5.6-sol", usage));
 expect(requestCostUsd("gpt-6-sol-2026-09-01", usage)).toBe(requestCostUsd("gpt-6-sol", usage));
});

/** US$ per 1M tokens, Standard tier (OpenAI pricing page, 25/09/2026). Cache writes cost 1.25× input on GPT-5.6 and later. */
type Price = { input: number; cached: number; write: number; output: number };
const PRICES: Record<string, Price> = {
 "gpt-6-sol": { input: 2, cached: 0.2, write: 2.5, output: 10 },
 "gpt-6-luna": { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 },
 "gpt-5.6-sol": { input: 4, cached: 0.4, write: 5, output: 20 },
 "gpt-5.1": { input: 1.25, cached: 0.125, write: 1.25, output: 10 },
};
/** Models without a checked price count above the most expensive one in use, so the daily cap never undercounts. */
const FALLBACK: Price = { input: 5, cached: 0.5, write: 6.25, output: 25 };
/** Above this many input tokens in one request, GPT-6 and GPT-5.6 bill 2× input and 1.5× output for the whole request. */
export const LONG_CONTEXT_TOKENS = 272_000;

export type RequestUsage = { inputTokens: number; cachedTokens: number; cacheWriteTokens: number; outputTokens: number };

export function priceOf(model: string): Price {
 const base = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
 return PRICES[base] ?? FALLBACK;
}

/** Cost of one API request. Cached and cache-write tokens are part of input_tokens, billed at their own rates. */
export function requestCostUsd(model: string, usage: RequestUsage): number {
 const price = priceOf(model);
 const long = /^gpt-(?:6|5\.6)-/.test(model) && usage.inputTokens > LONG_CONTEXT_TOKENS;
 const inputRate = long ? 2 : 1, outputRate = long ? 1.5 : 1;
 const cached = Math.min(usage.cachedTokens, usage.inputTokens);
 const written = Math.min(usage.cacheWriteTokens, usage.inputTokens - cached);
 const ordinary = usage.inputTokens - cached - written;
 return (inputRate * (ordinary * price.input + cached * price.cached + written * price.write) + outputRate * usage.outputTokens * price.output) / 1e6;
}

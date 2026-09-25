-- Cost of every Coach model call, base of the daily AI spend ceiling (COACH_DAILY_BUDGET_USD, default US$ 3).
-- Additive: two columns with defaults, plus an estimate for the calls recorded before them.
BEGIN;
ALTER TABLE coach_model_runs ADD COLUMN IF NOT EXISTS cache_write_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE coach_model_runs ADD COLUMN IF NOT EXISTS cost_usd numeric(12,6) NOT NULL DEFAULT 0;
-- Before explicit cache control every uncached input token was written to the cache (1.25× input).
UPDATE coach_model_runs SET cost_usd = CASE model
  WHEN 'gpt-6-sol' THEN ((input_tokens - cached_input_tokens) * 2.5 + cached_input_tokens * 0.2 + output_tokens * 10) / 1e6
  WHEN 'gpt-6-luna' THEN ((input_tokens - cached_input_tokens) * 0.125 + cached_input_tokens * 0.01 + output_tokens * 0.5) / 1e6
  WHEN 'gpt-5.6-sol' THEN ((input_tokens - cached_input_tokens) * 5 + cached_input_tokens * 0.4 + output_tokens * 20) / 1e6
  ELSE cost_usd END
WHERE cost_usd = 0;
COMMIT;

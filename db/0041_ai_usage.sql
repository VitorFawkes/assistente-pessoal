-- Ledger of every paid AI call of the Ações (Coach, assistant, meeting reports and tasks in n8n, transcription,
-- dictation, WhatsApp audio, repeated tasks), read by the admin "Gastos" page.
-- Append-only: the app roles can insert and read, never update or delete, so resetting the Coach or deleting
-- a meeting never erases what was spent. One row per call, keyed by `ref` (a replay never counts twice).
-- Additive: new tables, plus a copy of the Coach calls already recorded in coach_model_runs (needs 0040).
BEGIN;

CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL UNIQUE CHECK (length(ref) BETWEEN 1 AND 300),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  meeting_id uuid,
  agent text NOT NULL CHECK (length(agent) BETWEEN 1 AND 60),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  source text NOT NULL CHECK (source IN ('app','n8n','mac')),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_tokens bigint NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  cache_write_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  audio_seconds numeric(12,2) NOT NULL DEFAULT 0 CHECK (audio_seconds >= 0),
  cost_usd numeric(12,6) NOT NULL CHECK (cost_usd >= 0),
  -- 'medido': consumption reported by the provider (tokens or billed seconds) × official price.
  -- 'estimado': part of the consumption was not reported and was filled in (the note says how).
  basis text NOT NULL CHECK (basis IN ('medido','estimado')),
  note text CHECK (note IS NULL OR length(note) <= 300),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_occurred ON ai_usage (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_agent_occurred ON ai_usage (agent, occurred_at DESC);

-- Where the n8n reading stopped, per workflow (the highest execution id already read).
CREATE TABLE IF NOT EXISTS ai_usage_sync (
  source text PRIMARY KEY CHECK (length(source) BETWEEN 1 AND 120),
  last_id bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON ai_usage TO app_tenant, app_writer;
GRANT SELECT, INSERT, UPDATE ON ai_usage_sync TO app_tenant, app_writer;

-- Coach calls recorded so far (same ref the app writes from now on, so nothing counts twice).
-- Scheduled check-ins ran as "chat"; their job tells them apart.
INSERT INTO ai_usage (ref, user_id, agent, provider, model, source, input_tokens, cached_tokens, cache_write_tokens, output_tokens, cost_usd, basis, note, occurred_at)
SELECT 'coach_run:' || r.id, r.user_id,
  CASE
    WHEN r.purpose = 'chat' AND j.kind = 'checkin' THEN 'coach_mensagens'
    WHEN r.purpose = 'chat' THEN 'coach_conversa'
    WHEN r.purpose = 'quick' THEN 'coach_assistente'
    WHEN r.purpose = 'tasks' THEN 'coach_leitor'
    WHEN r.purpose = 'weekly' THEN 'coach_revisao'
    WHEN r.purpose = 'analysis' THEN 'coach_analise'
    ELSE 'coach_outros'
  END,
  r.provider, r.model, 'app', r.input_tokens, r.cached_input_tokens, r.cache_write_tokens, r.output_tokens, r.cost_usd,
  CASE WHEN r.usage_complete THEN 'medido' ELSE 'estimado' END,
  CASE WHEN r.usage_complete THEN NULL ELSE 'Consumo incompleto na resposta da IA.' END,
  r.created_at
FROM coach_model_runs r
LEFT JOIN coach_jobs j ON j.id::text = r.run_key AND j.user_id = r.user_id
WHERE r.cost_usd > 0 OR r.input_tokens > 0 OR r.output_tokens > 0
ON CONFLICT (ref) DO NOTHING;

COMMIT;

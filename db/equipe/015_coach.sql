-- Coach no Ações da equipe, só para o Vitor (29/09/2026). O banco da equipe já tem o Coach até a 0036;
-- aqui entram as partes 0037 a 0041 do Ações pessoal. Aditiva e repetível, sem DROP.
-- Diferença para o pessoal: o registro do "desfaz" (coach_task_changes) aponta só para a tarefa, porque na
-- equipe o Coach também muda tarefa que um colega passou para a pessoa (a tarefa é do colega, outro user_id).
BEGIN;

-- 0037: um envio só por chave (revisão da semana).
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS dedup_key text CHECK (length(dedup_key) <= 120);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_dedup ON whatsapp_messages(user_id,dedup_key) WHERE dedup_key IS NOT NULL;

-- 0038: mudanças que o Coach fez nas tarefas (antes/depois, para o "desfaz") e pedidos esperando "sim".
CREATE TABLE IF NOT EXISTS coach_task_changes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL,
 run_key text CHECK(length(run_key)<=200),
 tarefa_id uuid NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
 action text NOT NULL CHECK(action IN ('create','complete','cancel','reopen','reschedule','reassign','rename','priority')),
 before jsonb,
 after jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 undone_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS coach_task_changes_run ON coach_task_changes(user_id,run_key) WHERE run_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS coach_task_changes_recent ON coach_task_changes(user_id,created_at DESC) WHERE undone_at IS NULL;
ALTER TABLE coach_task_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_task_changes FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='coach_task_changes' AND policyname='coach_tenant') THEN
  CREATE POLICY coach_tenant ON coach_task_changes FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
 END IF;
END $$;
REVOKE ALL ON coach_task_changes FROM PUBLIC;
REVOKE ALL ON coach_task_changes FROM anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON coach_task_changes TO app_tenant,app_writer;

CREATE TABLE IF NOT EXISTS coach_task_proposals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 run_key text CHECK(length(run_key)<=200),
 actions jsonb NOT NULL CHECK(jsonb_typeof(actions)='array'),
 summary text NOT NULL CHECK(length(summary)<=4000),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 resolved_at timestamptz,
 resolution text CHECK(resolution IN ('confirmed','declined','superseded'))
);
CREATE UNIQUE INDEX IF NOT EXISTS coach_task_proposals_run ON coach_task_proposals(user_id,run_key) WHERE run_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS coach_task_proposals_open ON coach_task_proposals(user_id,created_at DESC) WHERE resolved_at IS NULL;
ALTER TABLE coach_task_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_task_proposals FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='coach_task_proposals' AND policyname='coach_tenant') THEN
  CREATE POLICY coach_tenant ON coach_task_proposals FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
 END IF;
END $$;
REVOKE ALL ON coach_task_proposals FROM PUBLIC;
REVOKE ALL ON coach_task_proposals FROM anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON coach_task_proposals TO app_tenant,app_writer;

-- 0039: objetivos de trabalho e de vida (até 3 ativos em cada área).
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS goal_area text CHECK (goal_area IN ('work','life'));
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS goal_due date;
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS goal_measure text CHECK (length(goal_measure) <= 500);

-- 0040: custo de cada chamada do Coach (base do teto diário).
ALTER TABLE coach_model_runs ADD COLUMN IF NOT EXISTS cache_write_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE coach_model_runs ADD COLUMN IF NOT EXISTS cost_usd numeric(12,6) NOT NULL DEFAULT 0;

-- 0041: registro de cada chamada paga de IA (só acrescenta; nunca muda nem apaga).
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
  basis text NOT NULL CHECK (basis IN ('medido','estimado')),
  note text CHECK (note IS NULL OR length(note) <= 300),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_occurred ON ai_usage (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_agent_occurred ON ai_usage (agent, occurred_at DESC);
CREATE TABLE IF NOT EXISTS ai_usage_sync (
  source text PRIMARY KEY CHECK (length(source) BETWEEN 1 AND 120),
  last_id bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ai_usage, ai_usage_sync FROM anon, authenticated;
GRANT SELECT, INSERT ON ai_usage TO app_tenant, app_writer;
GRANT SELECT, INSERT, UPDATE ON ai_usage_sync TO app_tenant, app_writer;

-- Semente da 0036 que faltava no banco da equipe: a linha única do estado do número do Coach. Sem ela o estado
-- nunca é gravado (o código só faz UPDATE ... WHERE id=1). Aplicada à parte em 29/09/2026 às 14h37.
INSERT INTO whatsapp_channel(id) VALUES (1) ON CONFLICT DO NOTHING;

COMMIT;

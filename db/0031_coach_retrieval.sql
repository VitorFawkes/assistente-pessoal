BEGIN;
CREATE TABLE IF NOT EXISTS coach_semantic_chunks (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 meeting_id uuid NOT NULL,
 chunk_index integer NOT NULL CHECK(chunk_index>=0),
 source_hash text NOT NULL,
 embedding real[] NOT NULL CHECK(array_length(embedding,1)=1536),
 embedding_model text NOT NULL,
 indexed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,meeting_id,chunk_index),
 FOREIGN KEY(meeting_id,user_id) REFERENCES meetings(id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS coach_semantic_user_idx ON coach_semantic_chunks(user_id,indexed_at DESC);
CREATE TABLE IF NOT EXISTS coach_model_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 run_key text,
 purpose text NOT NULL,
 provider text NOT NULL,
 model text NOT NULL,
 input_tokens bigint NOT NULL DEFAULT 0,
 output_tokens bigint NOT NULL DEFAULT 0,
 duration_ms integer NOT NULL DEFAULT 0,
 tool_calls integer NOT NULL DEFAULT 0,
 success boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE coach_model_runs ADD COLUMN IF NOT EXISTS cached_input_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE coach_model_runs ADD COLUMN IF NOT EXISTS usage_complete boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS coach_model_runs_user_idx ON coach_model_runs(user_id,created_at DESC);
ALTER TABLE coach_semantic_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_semantic_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE coach_model_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_model_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_tenant ON coach_semantic_chunks;
CREATE POLICY coach_tenant ON coach_semantic_chunks USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
DROP POLICY IF EXISTS coach_tenant ON coach_model_runs;
CREATE POLICY coach_tenant ON coach_model_runs USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
GRANT SELECT,INSERT,UPDATE,DELETE ON coach_semantic_chunks,coach_model_runs TO app_tenant,app_writer;
COMMIT;

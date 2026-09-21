-- Coach temporal memory, accepted commitments and retry-safe conversation writes.
-- Additive, repeatable; apply after 0028 as schema owner.
BEGIN;
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS morning_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS evening_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS nudges_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS morning_hour smallint NOT NULL DEFAULT 8 CHECK (morning_hour BETWEEN 0 AND 23);
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS evening_hour smallint NOT NULL DEFAULT 18 CHECK (evening_hour BETWEEN 0 AND 23);
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','paused','completed','superseded'));
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS valid_from timestamptz;
UPDATE coach_memories SET valid_from=created_at WHERE valid_from IS NULL;
ALTER TABLE coach_memories ALTER COLUMN valid_from SET DEFAULT now();
ALTER TABLE coach_memories ALTER COLUMN valid_from SET NOT NULL;
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS valid_until timestamptz;
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'legacy' CHECK (origin IN ('legacy','user','inferred'));
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS supersedes_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS coach_memories_owner_key ON coach_memories(id,user_id);
CREATE INDEX IF NOT EXISTS coach_memories_user_lifecycle ON coach_memories(user_id,lifecycle,kind,updated_at DESC);
CREATE INDEX IF NOT EXISTS coach_memories_supersedes ON coach_memories(supersedes_id,user_id) WHERE supersedes_id IS NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='coach_memories'::regclass AND conname='coach_memory_supersedes_owner') THEN
  ALTER TABLE coach_memories ADD CONSTRAINT coach_memory_supersedes_owner FOREIGN KEY(supersedes_id,user_id) REFERENCES coach_memories(id,user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='coach_memories'::regclass AND conname='coach_memory_validity') THEN
  ALTER TABLE coach_memories ADD CONSTRAINT coach_memory_validity CHECK(valid_until IS NULL OR valid_until>=valid_from);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='coach_memories'::regclass AND conname='coach_memory_no_self_replacement') THEN
  ALTER TABLE coach_memories ADD CONSTRAINT coach_memory_no_self_replacement CHECK(supersedes_id IS NULL OR supersedes_id<>id);
 END IF;
END $$;
ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS coach_messages_idempotency ON coach_messages(user_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS coach_messages_owner_key ON coach_messages(id,user_id);
CREATE UNIQUE INDEX IF NOT EXISTS tarefas_coach_owner_key ON tarefas(id,user_id);
CREATE TABLE IF NOT EXISTS coach_commitments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 tarefa_id uuid,
 source_message_id uuid,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 200),
 request_hash text NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','renegotiated','cancelled','unknown')),
 outcome text CHECK(outcome IS NULL OR length(outcome)<=4000),
 outcome_source text NOT NULL DEFAULT 'unknown' CHECK(outcome_source IN ('user_report','task_record','unknown')),
 due_at timestamptz,
 history jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(history)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,idempotency_key),
 FOREIGN KEY(tarefa_id,user_id) REFERENCES tarefas(id,user_id) ON DELETE SET NULL(tarefa_id),
 FOREIGN KEY(source_message_id,user_id) REFERENCES coach_messages(id,user_id) ON DELETE SET NULL(source_message_id)
);
CREATE INDEX IF NOT EXISTS coach_commitments_user_status ON coach_commitments(user_id,status,due_at);
CREATE INDEX IF NOT EXISTS coach_commitments_task ON coach_commitments(tarefa_id,user_id) WHERE tarefa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS coach_commitments_message ON coach_commitments(source_message_id,user_id) WHERE source_message_id IS NOT NULL;
ALTER TABLE coach_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_commitments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_tenant ON coach_commitments;
CREATE POLICY coach_tenant ON coach_commitments FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
REVOKE ALL ON coach_commitments FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON coach_commitments TO app_tenant,app_writer;
COMMENT ON COLUMN coach_memories.lifecycle IS 'Temporal validity is independent of confirmed/hypothesis/rejected truth status.';
COMMENT ON TABLE coach_commitments IS 'Only explicitly accepted user actions; task and action key committed atomically.';
COMMIT;

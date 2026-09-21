-- Durable, private coach jobs. No prompts or provider responses in operational logs.
BEGIN;
CREATE TABLE IF NOT EXISTS coach_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('chat','analyze','review','checkin')),
 idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 160),
 payload jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(payload)='object'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 profile_revision integer NOT NULL CHECK(profile_revision>0),
 attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_until timestamptz,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,idempotency_key),
 CHECK ((status='running') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS coach_jobs_pending ON coach_jobs(user_id,available_at,created_at) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS coach_jobs_history ON coach_jobs(user_id,created_at DESC);
ALTER TABLE coach_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_jobs_tenant ON coach_jobs;
CREATE POLICY coach_jobs_tenant ON coach_jobs FOR ALL
 USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid))
 WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
REVOKE ALL ON coach_jobs FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON coach_jobs TO app_tenant,app_writer;
COMMENT ON TABLE coach_jobs IS 'Tenant-scoped resumable work; retain idempotency identity across retries; never expose payload or lease tokens in progress APIs.';
COMMIT;

BEGIN;
-- Minimal private agenda snapshot. Microsoft OAuth remains in TTARS.
CREATE TABLE IF NOT EXISTS coach_calendar_cache (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT true,
 snapshot jsonb CHECK(snapshot IS NULL OR (jsonb_typeof(snapshot)='object' AND snapshot->>'version'='1' AND jsonb_typeof(snapshot->'events')='array')),
 error_status text CHECK(error_status IN ('connected','needs_reconnect','unavailable')),
 attempted_at timestamptz,
 lease_token uuid,
 lease_until timestamptz
);
ALTER TABLE coach_calendar_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_calendar_cache FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_tenant ON coach_calendar_cache;
CREATE POLICY coach_tenant ON coach_calendar_cache FOR ALL
 USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid))
 WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
REVOKE ALL ON coach_calendar_cache FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON coach_calendar_cache TO app_tenant,app_writer;
COMMIT;

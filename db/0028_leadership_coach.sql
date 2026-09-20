-- Private leadership coaching. Additive and repeatable; no existing data changes.
-- Apply as schema owner, using the existing app_tenant / app_writer roles.
BEGIN;

CREATE TABLE IF NOT EXISTS coach_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  weekly_enabled boolean NOT NULL DEFAULT false,
  goals text NOT NULL DEFAULT '',
  context text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  review_day smallint NOT NULL DEFAULT 5 CHECK (review_day BETWEEN 0 AND 6),
  review_hour smallint NOT NULL DEFAULT 17 CHECK (review_hour BETWEEN 0 AND 23),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  lease_token uuid,
  lease_until timestamptz,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE coach_profiles ALTER COLUMN review_day SET DEFAULT 5;
ALTER TABLE coach_profiles ALTER COLUMN review_hour SET DEFAULT 17;

CREATE TABLE IF NOT EXISTS coach_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('goal','context','pattern','experiment')),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 12000),
  content_hash text GENERATED ALWAYS AS (md5(lower(btrim(content)))) STORED,
  status text NOT NULL DEFAULT 'hypothesis' CHECK (status IN ('hypothesis','confirmed','rejected')),
  evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence) = 'array'),
  history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, content_hash)
);

CREATE TABLE IF NOT EXISTS coach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 40000),
  evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_messages_user_created ON coach_messages(user_id, created_at DESC, id);

-- The composite FK also prevents an analysis referencing another tenant's meeting.
CREATE UNIQUE INDEX IF NOT EXISTS meetings_coach_owner_key ON meetings(id, user_id);
CREATE TABLE IF NOT EXISTS coach_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL,
  source_hash text NOT NULL CHECK (length(source_hash) BETWEEN 16 AND 128),
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  chunk_count integer NOT NULL CHECK (chunk_count > 0 AND chunk_index < chunk_count),
  observations jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(observations) = 'array'),
  summary text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (meeting_id, user_id) REFERENCES meetings(id, user_id) ON DELETE CASCADE,
  UNIQUE (user_id, meeting_id, source_hash, chunk_index)
);
CREATE INDEX IF NOT EXISTS coach_analyses_user_created ON coach_analyses(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS coach_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  model text NOT NULL,
  profile_revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
ALTER TABLE coach_reviews ADD COLUMN IF NOT EXISTS profile_revision integer NOT NULL DEFAULT 0;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coach_profiles','coach_memories','coach_messages','coach_analyses','coach_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS coach_tenant ON %I', t);
    EXECUTE format('CREATE POLICY coach_tenant ON %I FOR ALL USING
      (user_id = (SELECT nullif(current_setting(''app.current_user_id'', true), '''')::uuid))
      WITH CHECK (user_id = (SELECT nullif(current_setting(''app.current_user_id'', true), '''')::uuid))', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_tenant, app_writer', t);
  END LOOP;
END $$;

COMMENT ON TABLE coach_memories IS 'Private user-correctable coaching memory; hypotheses are never facts by default.';
COMMENT ON COLUMN coach_profiles.revision IS 'Increment on user corrections/settings/reset; reject stale AI writes under a row lock.';
COMMENT ON COLUMN coach_profiles.lease_token IS 'Server-only owner token; an expired runner cannot release a newer runner lease.';
COMMIT;

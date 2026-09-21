-- Server-owned secondary-context versions. Existing history is preserved.
BEGIN;
ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS context_sources jsonb NOT NULL DEFAULT '[]'::jsonb;
-- NULL identifies legacy guidance; version 1 may legitimately have zero meeting sources.
ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS context_version integer;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='coach_messages'::regclass AND conname='coach_messages_context_sources_array') THEN
  ALTER TABLE coach_messages ADD CONSTRAINT coach_messages_context_sources_array CHECK (jsonb_typeof(context_sources)='array');
 END IF;
END $$;
COMMIT;

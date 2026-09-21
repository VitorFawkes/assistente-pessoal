-- Preserve inherited weekly membership, including prior periods with no meetings.
BEGIN;
ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS context_periods jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='coach_messages'::regclass AND conname='coach_messages_context_periods_array') THEN
  ALTER TABLE coach_messages ADD CONSTRAINT coach_messages_context_periods_array CHECK (jsonb_typeof(context_periods)='array');
 END IF;
END $$;
-- Existing messages/reviews remain intact. Context version 2 identifies complete
-- inherited lineage; older guidance is excluded from new model context.
COMMIT;

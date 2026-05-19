-- ─────────────────────────────────────────────────────────────────────
-- Adiciona segments JSONB em meetings — diarização via gpt-4o-transcribe-diarize.
-- Cada segment: { speaker, start, end, text }
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS segments JSONB;

COMMENT ON COLUMN meetings.segments IS
  'Diarização: array de { speaker, start, end, text } vindo do gpt-4o-transcribe-diarize. NULL = transcrito sem diarização (Whisper antigo) ou áudio silent.';

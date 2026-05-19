-- ─────────────────────────────────────────────────────────────────────
-- speaker_labels: mapeia letra de speaker (A, B, C…) → nome
-- Ex: {"A": "Vitor", "B": "Ana", "C": "?"}
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS speaker_labels JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN meetings.speaker_labels IS
  'Mapeamento speaker letter -> nome. Usado pra reprocessar tarefas com contexto correto de quem falou.';

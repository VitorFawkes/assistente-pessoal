-- ─────────────────────────────────────────────────────────────────────
-- pessoas: identidade estável pra mapeamento speaker→pessoa (Fase 1)
--
-- Decisões:
--   - meetings.speaker_labels (existente) continua sendo { letter: nome }
--     — preserva o workflow n8n "acoes-reprocess-tarefas" que lê esse formato.
--   - meetings.speaker_pessoas (nova) é { letter: pessoa_uuid } — fonte de
--     verdade pra voice fingerprinting (FK estável, sem ambiguidade de nome).
--   - speaker_labels_proposed é a sugestão automática do voice-svc (Fase 3).
--   - voice_samples + pgvector vêm na 0005 (Fase 2).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pessoas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  is_vitor BOOLEAN NOT NULL DEFAULT FALSE,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pessoas_is_vitor ON pessoas(is_vitor) WHERE is_vitor;

DROP TRIGGER IF EXISTS trg_pessoas_updated_at ON pessoas;
CREATE TRIGGER trg_pessoas_updated_at
  BEFORE UPDATE ON pessoas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── meetings: novas colunas ────────────────────────────────────────
-- speaker_pessoas: { "A": "uuid-pessoa", "B": "uuid-pessoa" }
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS speaker_pessoas JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN meetings.speaker_pessoas IS
  'Fonte de verdade pessoa<>letter. Formato { letter: pessoa_uuid }. meetings.speaker_labels (nome) é derivado disso pela aplicação — mantido pra workflow n8n.';

-- speaker_labels_proposed: sugestões do voice-svc (Fase 3)
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS speaker_labels_proposed JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN meetings.speaker_labels_proposed IS
  'Sugestões automáticas do voice-svc. Formato { letter: { pessoa_id, nome, confidence, sample_count } }. Usuário confirma via UI.';

-- ─── seed: Vitor (dono do sistema) ──────────────────────────────────
INSERT INTO pessoas (nome, is_vitor) VALUES ('Vitor', TRUE)
ON CONFLICT (nome) DO UPDATE SET is_vitor = TRUE;

-- ─────────────────────────────────────────────────────────────────────
-- BACKFILL: lê meetings.speaker_labels existentes ({ letter: nome })
-- → cria pessoas pra cada nome distinto válido
-- → popula meetings.speaker_pessoas com { letter: pessoa_uuid }
--
-- Entradas com nome vazio, "?" ou whitespace são ignoradas.
-- speaker_labels NÃO é modificado.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO pessoas (nome)
SELECT DISTINCT trim(value)
FROM meetings, jsonb_each_text(speaker_labels)
WHERE value IS NOT NULL
  AND trim(value) <> ''
  AND trim(value) <> '?'
ON CONFLICT (nome) DO NOTHING;

UPDATE meetings m SET speaker_pessoas = COALESCE((
  SELECT jsonb_object_agg(kv.key, p.id::text)
  FROM jsonb_each_text(m.speaker_labels) kv
  JOIN pessoas p ON p.nome = trim(kv.value)
  WHERE trim(kv.value) NOT IN ('', '?')
), '{}'::jsonb)
WHERE m.speaker_labels IS NOT NULL
  AND m.speaker_labels <> '{}'::jsonb
  AND m.speaker_pessoas = '{}'::jsonb;

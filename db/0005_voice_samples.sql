-- ─────────────────────────────────────────────────────────────────────
-- voice_samples: embeddings de voz pra fingerprinting cumulativo (Fase 2)
--
-- Pré-requisito: pgvector instalado.
--   SELECT extversion FROM pg_extension WHERE extname='vector';
-- Se vazio, trocar imagem Postgres no easypanel pra pgvector/pgvector:pg16
-- (ou equivalente) antes de aplicar.
--
-- Modelo: SpeechBrain ECAPA-TDNN, embedding 192d, normalizado L2,
-- comparado por cosine distance (operador <=> do pgvector).
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS voice_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pessoa_id UUID NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  embedding vector(192) NOT NULL,
  source_meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  source_speaker_letter TEXT,            -- "A", "B"... no contexto da meeting
  source_segment_range TEXT,             -- "12.30-45.70" — start-end em segundos pra replay
  duration_seconds REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  soft_deleted_at TIMESTAMPTZ            -- NULL = ativo
);

COMMENT ON TABLE voice_samples IS
  'Amostras de voz pra fingerprinting. Embedding via SpeechBrain ECAPA-TDNN (192d, L2-normalized). Soft delete via soft_deleted_at.';

-- Lookup rápido por pessoa (listar amostras / contar)
CREATE INDEX IF NOT EXISTS idx_voice_samples_pessoa
  ON voice_samples(pessoa_id) WHERE soft_deleted_at IS NULL;

-- Lookup por meeting (auditoria + reprocessamento)
CREATE INDEX IF NOT EXISTS idx_voice_samples_meeting
  ON voice_samples(source_meeting_id) WHERE soft_deleted_at IS NULL;

-- HNSW cosine pra ANN. Sem partial WHERE pra compat com pgvector < 0.7;
-- filtramos soft_deleted_at na query via predicate.
CREATE INDEX IF NOT EXISTS idx_voice_samples_hnsw
  ON voice_samples USING hnsw (embedding vector_cosine_ops);

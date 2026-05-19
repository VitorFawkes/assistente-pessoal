-- ═════════════════════════════════════════════════════════════════════
-- ⚠️  ATENÇÃO: SEM pgvector  ⚠️
-- ═════════════════════════════════════════════════════════════════════
-- Esta migration USA `REAL[]` em vez de `vector(192)` porque a imagem
-- atual do Postgres (postgres:17 oficial) NÃO tem a extensão pgvector
-- disponível. Verificado em 2026-05-19: pg_available_extensions WHERE
-- name='vector' → vazio.
--
-- Consequências:
--   - Busca de similaridade (top-K) é feita NO PYTHON dentro do voice-svc,
--     não em SQL — voice-svc faz SELECT de TODAS as amostras ativas,
--     calcula cosine com numpy, ordena.
--   - Complexidade O(n) por query identify. Em escala single-user (até
--     ~10.000 amostras) é imperceptível. Acima disso fica lento.
--
-- SE BUSCAS POR VOZ FICAREM LENTAS NO FUTURO, esta é a causa provável.
-- A migração pra pgvector quando isso virar problema é:
--   1. Trocar imagem postgres no easypanel pra pgvector/pgvector:pg17
--      (backup antes! destroy/create do service pode perder volume)
--   2. CREATE EXTENSION vector;
--   3. ALTER TABLE voice_samples
--        ALTER COLUMN embedding TYPE vector(192)
--        USING embedding::vector;
--   4. CREATE INDEX voice_samples_hnsw ON voice_samples
--        USING hnsw (embedding vector_cosine_ops)
--        WHERE soft_deleted_at IS NULL;
--   5. Reverter voice-svc/db.py.search_top_k pra usar operador `<=>`.
--      Ver git blame deste arquivo pra encontrar a versão pgvector
--      original (commit antes de 2026-05-19).
--
-- Veja também: /AGENTS.md (raiz) e voice-svc/README.md seção "Débito técnico".
-- ═════════════════════════════════════════════════════════════════════

-- 192d = dimensão do embedding ECAPA-TDNN, normalizado L2 (||v|| = 1).
-- Como os vetores estão L2-normalizados, cosine_similarity = dot_product
-- (faz a busca no Python ficar uma multiplicação de matriz simples).

CREATE TABLE IF NOT EXISTS voice_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pessoa_id UUID NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  embedding REAL[] NOT NULL CHECK (array_length(embedding, 1) = 192),
  source_meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  source_speaker_letter TEXT,
  source_segment_range TEXT,
  duration_seconds REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  soft_deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE voice_samples IS
  'Amostras de voz pra fingerprinting. Embedding via SpeechBrain ECAPA-TDNN (192d, L2-normalized). ATENÇÃO: usa REAL[] em vez de pgvector — ver topo de db/0005_voice_samples.sql.';

COMMENT ON COLUMN voice_samples.embedding IS
  'REAL[192] L2-normalizado. Busca cosine feita no Python (voice-svc/db.py search_top_k). Migrar pra vector(192) se virar gargalo — ver AGENTS.md.';

CREATE INDEX IF NOT EXISTS idx_voice_samples_pessoa
  ON voice_samples(pessoa_id) WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_voice_samples_meeting
  ON voice_samples(source_meeting_id) WHERE soft_deleted_at IS NULL;

-- NÃO há índice de similaridade. Filtro WHERE soft_deleted_at IS NULL +
-- SELECT all + cosine em Python via numpy. Funciona até ~10k amostras.

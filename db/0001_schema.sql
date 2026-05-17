-- ─────────────────────────────────────────────────────────────────────
-- Assistente Pessoal — schema inicial
-- Single-user (sem RLS). Para rodar:
--   psql "$DATABASE_URL" -f db/0001_schema.sql
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── função util para updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── meetings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('macbook','iphone')),
  meeting_type TEXT CHECK (meeting_type IN ('online','presencial','desconhecido')),
  original_filename TEXT NOT NULL,
  audio_path TEXT NOT NULL,                       -- /audios/2026/05/uuid.mp3
  audio_size_bytes BIGINT,
  duration_seconds INT,
  recorded_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','transcribing','analyzing','done','error')),
  status_error TEXT,
  transcription TEXT,
  summary TEXT,
  raw_ai_response JSONB,                          -- JSON bruto da GPT pra debug
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meetings_status   ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_recorded ON meetings(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_created  ON meetings(created_at DESC);

-- ─── tarefas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  owner TEXT NOT NULL DEFAULT 'vitor',            -- 'vitor' (eu) ou nome literal mencionado
  is_mine BOOLEAN GENERATED ALWAYS AS (owner = 'vitor') STORED,
  prazo TIMESTAMPTZ,
  prazo_text TEXT,                                -- texto literal antes do parsing
  prioridade TEXT NOT NULL DEFAULT 'media'
    CHECK (prioridade IN ('baixa','media','alta','urgente')),
  status TEXT NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta','em_andamento','concluida','cancelada')),
  evidencia TEXT,                                 -- citação do trecho que originou a tarefa
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluida_em TIMESTAMPTZ,
  cancelada_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tarefas_status_abertas ON tarefas(status)
  WHERE status NOT IN ('concluida','cancelada');
CREATE INDEX IF NOT EXISTS idx_tarefas_owner   ON tarefas(owner);
CREATE INDEX IF NOT EXISTS idx_tarefas_prazo   ON tarefas(prazo)
  WHERE prazo IS NOT NULL AND status NOT IN ('concluida','cancelada');
CREATE INDEX IF NOT EXISTS idx_tarefas_meeting ON tarefas(meeting_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_created ON tarefas(created_at DESC);

DROP TRIGGER IF EXISTS trg_tarefas_updated_at ON tarefas;
CREATE TRIGGER trg_tarefas_updated_at
  BEFORE UPDATE ON tarefas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── tarefa_eventos (log de mudanças) ───────────────────────────────
CREATE TABLE IF NOT EXISTS tarefa_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  evento TEXT NOT NULL CHECK (evento IN
    ('criada','editada','concluida','reaberta','cancelada','prazo_alterado','prioridade_alterada')),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tarefa_eventos_tarefa ON tarefa_eventos(tarefa_id, created_at DESC);

-- ─── views úteis pro frontend ───────────────────────────────────────
CREATE OR REPLACE VIEW v_tarefas_abertas AS
SELECT
  t.*,
  m.recorded_at AS meeting_recorded_at,
  m.summary     AS meeting_summary,
  m.meeting_type
FROM tarefas t
LEFT JOIN meetings m ON m.id = t.meeting_id
WHERE t.status IN ('aberta','em_andamento');

CREATE OR REPLACE VIEW v_tarefas_vencendo AS
SELECT *
FROM v_tarefas_abertas
WHERE prazo IS NOT NULL
  AND prazo <= now() + interval '1 day';

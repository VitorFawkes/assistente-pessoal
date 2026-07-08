-- ─────────────────────────────────────────────────────────────────────
-- 0021_tarefa_anexos.sql — Anexos de tarefa: links + arquivos (bytea)
--
-- Transforma a tarefa em informação rica: uma lista ordenada de anexos por
-- tarefa, cada um sendo um LINK (url) ou um ARQUIVO (bytes em bytea). Vale
-- para o dono e para o convidado do quadro (RLS herda de tarefas, igual a
-- tarefa_pessoas).
--
-- Aditiva, idempotente, não-destrutiva. Aplicar em produção:
--   psql "$DATABASE_URL" -f db/0021_tarefa_anexos.sql
-- (na prática, via docker exec no container n8n_assistente-pessoal-db)
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS tarefa_anexos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id    UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('link', 'arquivo')),
  -- link
  url          TEXT,
  -- rótulo exibido: título do link OU nome amigável (fallback: filename/host)
  titulo       TEXT,
  -- arquivo
  filename     TEXT,
  content_type TEXT,
  size_bytes   INTEGER,
  conteudo     BYTEA,
  ordem        INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- auditoria: qual convidado adicionou (NULL = o dono)
  quadro_convidado_id UUID REFERENCES quadro_convidados(id) ON DELETE SET NULL,
  CONSTRAINT tarefa_anexos_shape CHECK (
    (tipo = 'link'    AND url IS NOT NULL AND length(trim(url)) > 0) OR
    (tipo = 'arquivo' AND filename IS NOT NULL AND conteudo IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tarefa_anexos_tarefa
  ON tarefa_anexos(tarefa_id, ordem, created_at);

-- RLS: espelha tarefa_pessoas. A visibilidade cai da própria tarefa — o
-- EXISTS só passa quando a tarefa é visível ao tenant corrente (RLS de tarefas).
ALTER TABLE tarefa_anexos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarefa_anexos_tenant ON tarefa_anexos;
CREATE POLICY tarefa_anexos_tenant ON tarefa_anexos FOR ALL
  USING (EXISTS (SELECT 1 FROM tarefas WHERE tarefas.id = tarefa_anexos.tarefa_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON tarefa_anexos TO app_tenant, app_writer;

COMMIT;

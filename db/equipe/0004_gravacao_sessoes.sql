-- Tracking para sessões de gravação em progresso
-- Usada para detectar timeout (10 min sem pedaço) e permitir retomada

CREATE TABLE IF NOT EXISTS gravacao_sessoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chunks_count INT NOT NULL DEFAULT 0,
  last_chunk_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gravacao_sessoes_user_id ON gravacao_sessoes(user_id);
CREATE INDEX IF NOT EXISTS idx_gravacao_sessoes_last_chunk ON gravacao_sessoes(last_chunk_at) WHERE finalizada_em IS NULL;

-- RLS: tabela é interna (n8n/voice-svc/frontend apenas), mas habilita por segurança
ALTER TABLE gravacao_sessoes ENABLE ROW LEVEL SECURITY;

-- app_tenant (frontend): ler/escrever só sessões do próprio usuário
CREATE POLICY gravacao_sessoes_rls ON gravacao_sessoes
  FOR ALL
  TO app_tenant
  USING (user_id::text = current_setting('app.current_user_id', true))
  WITH CHECK (user_id::text = current_setting('app.current_user_id', true));

-- app_writer (n8n/voice-svc): sem restrição (BYPASSRLS)
GRANT SELECT, INSERT, UPDATE ON gravacao_sessoes TO app_writer;
GRANT SELECT, INSERT, UPDATE ON gravacao_sessoes TO app_tenant;

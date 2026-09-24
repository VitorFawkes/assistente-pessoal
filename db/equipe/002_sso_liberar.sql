-- ─────────────────────────────────────────────────────────────────────
-- db/equipe/002_sso_liberar.sql
-- W2: Login pela aba do TTARS + liberar pessoas
--
-- Tabelas novas: acessos_equipe (liberações por e-mail), jti (JWT de uso único)
-- Coluna nova: users.times (times do TTARS em JSONB)
--
-- Aplicar APÓS: 0007_multitenant.sql
--
-- Idempotente: IF NOT EXISTS / DROP IF EXISTS
-- ─────────────────────────────────────────────────────────────────────

-- Coluna times em users (armazena array de times do TTARS)
ALTER TABLE users ADD COLUMN IF NOT EXISTS times JSONB NOT NULL DEFAULT '[]'::JSONB;

-- Tabela de liberações por e-mail (para acesso ao Ações pela equipe)
CREATE TABLE IF NOT EXISTS acessos_equipe (
  email           TEXT PRIMARY KEY,
  liberado        BOOLEAN NOT NULL DEFAULT FALSE,
  alterado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  alterado_por    UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_acessos_equipe_liberado
  ON acessos_equipe(liberado) WHERE liberado = TRUE;

-- Tabela de JWT JTI (JSON Token ID) para evitar replay attacks
CREATE TABLE IF NOT EXISTS jti_tokens (
  jti       TEXT PRIMARY KEY,
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  exp_at    TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jti_tokens_exp_at
  ON jti_tokens(exp_at DESC);

-- RLS não é necessário para acessos_equipe (usada só em verificações internas)
-- e jti_tokens (apenas backend precisa validar).
-- Se algum dia precisar fazer SELECT de acessos_equipe pelo app_tenant,
-- adicione policy similar às demais:
-- ALTER TABLE acessos_equipe ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY acessos_equipe_self ON acessos_equipe
--   FOR SELECT USING (email = (SELECT email FROM users WHERE id::text = current_setting('app.current_user_id', true)));

-- Grants: ambos app_tenant e app_writer lêem/escrevem em acessos_equipe
-- (validação de liberação é feita por verificação interna, não por RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON acessos_equipe TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON acessos_equipe TO app_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON jti_tokens TO app_writer;

-- Cleanup automático de JTI expirados (opcional: pode fazer via cron)
-- Executar periodicamente: DELETE FROM jti_tokens WHERE exp_at < now();

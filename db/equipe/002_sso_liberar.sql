-- ─────────────────────────────────────────────────────────────────────
-- db/equipe/002_sso_liberar.sql
-- Tabelas para SSO do TTARS: acessos_equipe, jti_usados, times em users.
--
-- Aplicar:
--   psql "$DATABASE_URL" -f db/equipe/002_sso_liberar.sql
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, DROP IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────

-- ─── users: adiciona coluna times (JSON com {id, nome}) ────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS times JSONB DEFAULT '[]'::jsonb;

-- ─── acessos_equipe: controle de quem pode acessar ────────────────────
-- Tabela que governa quem está liberado. Admin sempre liberado.
-- Email é case-insensitive e único por simplificação (TTARS normaliza).
CREATE TABLE IF NOT EXISTS acessos_equipe (
  email             TEXT PRIMARY KEY COLLATE "C",
  liberado          BOOLEAN NOT NULL DEFAULT FALSE,
  alterado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  alterado_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acessos_liberado
  ON acessos_equipe(liberado) WHERE liberado = TRUE;

-- ─── jti_usados: JTI de uso único (prevenção de replay) ───────────────
-- Armazena JTIs já usados do JWT. Limpar anualmente ou via cron.
CREATE TABLE IF NOT EXISTS jti_usados (
  jti       TEXT PRIMARY KEY,
  usado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jti_criado
  ON jti_usados(usado_em DESC);

-- ─── Permissions: REVOKE dos roles default, GRANT dos app roles ───────
-- Tabelas novas não herdam grants — aplicar explicitamente.

-- acessos_equipe: só app_tenant e app_writer podem ler
REVOKE ALL ON acessos_equipe FROM anon, authenticated;
GRANT SELECT ON acessos_equipe TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON acessos_equipe TO app_writer;

-- jti_usados: app_writer insere, app_tenant pode ler (verificação JWT)
REVOKE ALL ON jti_usados FROM anon, authenticated;
GRANT SELECT ON jti_usados TO app_tenant;
GRANT SELECT, INSERT, DELETE ON jti_usados TO app_writer;

-- users: app_tenant pode ler/atualizar own record; app_writer sem restrição
REVOKE SELECT, UPDATE ON users FROM anon, authenticated;
GRANT SELECT, UPDATE ON users TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO app_writer;

-- Sequências da users (caso seja necessário recriar usuários)
ALTER SEQUENCE IF EXISTS users_id_seq OWNER TO postgres;
REVOKE ALL ON SEQUENCE users_id_seq FROM anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq TO app_tenant, app_writer;

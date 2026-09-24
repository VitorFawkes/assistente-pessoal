-- Só no banco da equipe: entrada pela aba do TTARS por código de uso único
-- e a lista de pessoas do TTARS (atualizada quando o admin entra pela aba).
CREATE TABLE IF NOT EXISTS codigos_entrada (
  codigo        TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  nome          TEXT NOT NULL,
  ttars_user_id TEXT NOT NULL,
  times         JSONB NOT NULL DEFAULT '[]'::jsonb,
  expira_em     TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS ttars_pessoas (
  email         TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  organizacao   TEXT,
  times         JSONB NOT NULL DEFAULT '[]'::jsonb,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON codigos_entrada, ttars_pessoas FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON codigos_entrada, ttars_pessoas TO app_tenant, app_writer;

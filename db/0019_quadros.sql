-- ─────────────────────────────────────────────────────────────────────
-- 0019_quadros.sql — Quadros compartilháveis por token
--
-- Cria tabelas de quadros (curadoria manual de tarefas) com suporte a
-- convidados via token passwordless (SECURITY DEFINER resolver_quadro_token).
-- RLS + auditoria via tarefa_eventos.quadro_convidado_id.
--
-- Aditiva, idempotente, não-destrutiva. Para aplicar em produção:
--   psql "$DATABASE_URL" -f db/0019_quadros.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

-- Quadro: pertence a um tenant (dono). Lista curada de tarefas, compartilhável.
CREATE TABLE IF NOT EXISTS quadros (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_quadros_user ON quadros(user_id) WHERE archived_at IS NULL;

-- Membership: quais tarefas estão no quadro (curadoria manual).
CREATE TABLE IF NOT EXISTS quadro_tarefas (
  quadro_id  UUID NOT NULL REFERENCES quadros(id) ON DELETE CASCADE,
  tarefa_id  UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  ordem      INT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quadro_id, tarefa_id)
);
CREATE INDEX IF NOT EXISTS idx_quadro_tarefas_tarefa ON quadro_tarefas(tarefa_id);

-- Convidados: 1 token (link) por pessoa. Token = credencial passwordless.
CREATE TABLE IF NOT EXISTS quadro_convidados (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quadro_id    UUID NOT NULL REFERENCES quadros(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_quadro_convidados_quadro ON quadro_convidados(quadro_id);

-- Atribuição de ações do convidado na auditoria existente.
ALTER TABLE tarefa_eventos
  ADD COLUMN IF NOT EXISTS quadro_convidado_id UUID NULL REFERENCES quadro_convidados(id) ON DELETE SET NULL;

-- RLS (espelha tarefa_frentes/tarefa_pessoas). Dono opera via withTenant(user_id).
ALTER TABLE quadros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadros_tenant ON quadros;
CREATE POLICY quadros_tenant ON quadros FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

ALTER TABLE quadro_tarefas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadro_tarefas_tenant ON quadro_tarefas;
CREATE POLICY quadro_tarefas_tenant ON quadro_tarefas FOR ALL
  USING (EXISTS (SELECT 1 FROM quadros q WHERE q.id = quadro_tarefas.quadro_id));

ALTER TABLE quadro_convidados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadro_convidados_tenant ON quadro_convidados;
CREATE POLICY quadro_convidados_tenant ON quadro_convidados FOR ALL
  USING (EXISTS (SELECT 1 FROM quadros q WHERE q.id = quadro_convidados.quadro_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON quadros, quadro_tarefas, quadro_convidados
  TO app_tenant, app_writer;

-- Porta única do convidado: resolve o token SEM contexto de tenant.
-- SECURITY DEFINER → roda como dono da função (lê através do RLS) e devolve
-- só o mínimo pra bootstrapar o acesso, e só se o token é válido.
CREATE OR REPLACE FUNCTION resolver_quadro_token(p_token TEXT)
RETURNS TABLE (
  quadro_id UUID, user_id UUID, quadro_nome TEXT,
  convidado_id UUID, convidado_nome TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.user_id, q.nome, g.id, g.nome
  FROM quadro_convidados g
  JOIN quadros q ON q.id = g.quadro_id
  WHERE g.token = p_token
    AND g.revoked_at IS NULL
    AND q.archived_at IS NULL;
$$;
REVOKE ALL ON FUNCTION resolver_quadro_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_quadro_token(TEXT) TO app_tenant, app_writer;

COMMIT;

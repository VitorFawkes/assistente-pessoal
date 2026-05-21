-- ─────────────────────────────────────────────────────────────────────
-- db/0007_multitenant.sql
-- Foundation multi-tenant: tabelas users/invites/sessions/audit_log/usage_events,
-- user_id em meetings/tarefas/pessoas/voice_samples, backfill pro Vitor,
-- CHECK NOT VALID + VALIDATE, RLS habilitada com policies, índices compostos.
--
-- Aplicar:
--   psql "$DATABASE_URL" -f db/0007_multitenant.sql
--
-- Idempotente: todas DDLs com IF [NOT] EXISTS / DROP IF EXISTS.
--
-- Pré-requisito: roles `app_tenant` (NOBYPASSRLS) e `app_writer` (BYPASSRLS)
-- já criados — veja Task 0.2 do plano.
-- ─────────────────────────────────────────────────────────────────────

-- ─── users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  email            TEXT,
  whatsapp         TEXT,
  is_admin         BOOLEAN NOT NULL DEFAULT FALSE,
  consent_terms_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active
  ON users(email) WHERE email IS NOT NULL AND deleted_at IS NULL;

-- ─── invites: links gerados pelo admin ────────────────────────────────
CREATE TABLE IF NOT EXISTS invites (
  code           TEXT PRIMARY KEY,
  nome_sugerido  TEXT NOT NULL,
  created_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at    TIMESTAMPTZ,
  consumed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invites_unused
  ON invites(created_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- ─── sessions: cookie persistente (TTL 30d com sliding via last_used_at) ─
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address    INET,
  user_agent    TEXT,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions(user_id) WHERE revoked_at IS NULL;

-- ─── audit_log: ações sensíveis ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_id   TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_created   ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_log(action,  created_at DESC);

-- ─── usage_events: placeholder pro sub-projeto 4 ──────────────────────
CREATE TABLE IF NOT EXISTS usage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id  UUID REFERENCES meetings(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  units       NUMERIC NOT NULL,
  cost_usd    NUMERIC NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_user_created
  ON usage_events(user_id, created_at DESC);

-- ─── ALTERs em tabelas existentes (FK ON DELETE RESTRICT) ─────────────
ALTER TABLE meetings       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE tarefas        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE pessoas        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE voice_samples  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;

-- ─── Índices compostos otimizados pro padrão de query real ────────────
DROP INDEX IF EXISTS idx_meetings_status;
CREATE INDEX IF NOT EXISTS idx_meetings_user_status   ON meetings(user_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_user_recorded ON meetings(user_id, recorded_at DESC);

DROP INDEX IF EXISTS idx_tarefas_status_abertas;
CREATE INDEX IF NOT EXISTS idx_tarefas_user_status_abertas
  ON tarefas(user_id, status)
  WHERE status NOT IN ('concluida','cancelada');
CREATE INDEX IF NOT EXISTS idx_tarefas_user_prazo
  ON tarefas(user_id, prazo)
  WHERE prazo IS NOT NULL AND status NOT IN ('concluida','cancelada');

CREATE INDEX IF NOT EXISTS idx_voice_samples_user_active
  ON voice_samples(user_id) WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pessoas_user ON pessoas(user_id);

-- ─── Pessoas: UNIQUE global vira UNIQUE (user_id, nome) ───────────────
ALTER TABLE pessoas DROP CONSTRAINT IF EXISTS pessoas_nome_key;
ALTER TABLE pessoas ADD CONSTRAINT pessoas_user_nome_key UNIQUE (user_id, nome);

-- ─── Backfill: dentro de transação (DDL Postgres atomic) ──────────────
-- Cria user Vitor idempotentemente + atribui tudo a ele.
-- Inclui consent_terms_at=now() pra Vitor (você sabe o que tá fazendo —
-- não vai cair na tela de termos).
DO $$
DECLARE
  vitor_id UUID;
BEGIN
  INSERT INTO users (nome, is_admin, consent_terms_at)
  SELECT 'Vitor', TRUE, now()
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin = TRUE AND deleted_at IS NULL)
  RETURNING id INTO vitor_id;

  IF vitor_id IS NULL THEN
    SELECT id INTO vitor_id FROM users
    WHERE is_admin = TRUE AND deleted_at IS NULL LIMIT 1;
  END IF;

  UPDATE meetings      SET user_id = vitor_id WHERE user_id IS NULL;
  UPDATE tarefas       SET user_id = vitor_id WHERE user_id IS NULL;
  UPDATE pessoas       SET user_id = vitor_id WHERE user_id IS NULL;
  UPDATE voice_samples SET user_id = vitor_id WHERE user_id IS NULL;

  INSERT INTO audit_log (user_id, action, metadata)
  VALUES (vitor_id, 'backfill.completed', jsonb_build_object('migrated_at', now()));
END $$;

-- ─── NOT NULL via CHECK CONSTRAINT NOT VALID (lock fraco) ─────────────
-- SET NOT NULL adquire AccessExclusiveLock e escaneia tabela inteira.
-- CHECK NOT VALID adquire só ShareUpdateExclusiveLock (permite SELECT/UPDATE simultâneos).
-- VALIDATE faz o scan com ShareLock (também permite leituras).
ALTER TABLE meetings      ADD CONSTRAINT meetings_user_id_not_null      CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE tarefas       ADD CONSTRAINT tarefas_user_id_not_null       CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE pessoas       ADD CONSTRAINT pessoas_user_id_not_null       CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE voice_samples ADD CONSTRAINT voice_samples_user_id_not_null CHECK (user_id IS NOT NULL) NOT VALID;

ALTER TABLE meetings      VALIDATE CONSTRAINT meetings_user_id_not_null;
ALTER TABLE tarefas       VALIDATE CONSTRAINT tarefas_user_id_not_null;
ALTER TABLE pessoas       VALIDATE CONSTRAINT pessoas_user_id_not_null;
ALTER TABLE voice_samples VALIDATE CONSTRAINT voice_samples_user_id_not_null;

-- ─── RLS: defesa em profundidade ──────────────────────────────────────
-- Aplicação seta SET LOCAL app.current_user_id = '<uuid>' por transação.
-- App role NÃO deve ter BYPASSRLS (app_tenant). n8n e voice-svc usam
-- app_writer (BYPASSRLS) e propagam user_id explícito nas INSERTs.
ALTER TABLE meetings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pessoas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_samples  ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefa_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meetings_tenant       ON meetings;
DROP POLICY IF EXISTS tarefas_tenant        ON tarefas;
DROP POLICY IF EXISTS pessoas_tenant        ON pessoas;
DROP POLICY IF EXISTS voice_samples_tenant  ON voice_samples;
DROP POLICY IF EXISTS usage_events_tenant   ON usage_events;
DROP POLICY IF EXISTS tarefa_eventos_tenant ON tarefa_eventos;

CREATE POLICY meetings_tenant       ON meetings       FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY tarefas_tenant        ON tarefas        FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY pessoas_tenant        ON pessoas        FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY voice_samples_tenant  ON voice_samples  FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY usage_events_tenant   ON usage_events   FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));

-- tarefa_eventos: herda tenant via tarefa (RLS em tarefas filtra)
CREATE POLICY tarefa_eventos_tenant ON tarefa_eventos
  FOR ALL
  USING (EXISTS (SELECT 1 FROM tarefas WHERE tarefas.id = tarefa_eventos.tarefa_id));

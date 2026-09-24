-- ─────────────────────────────────────────────────────────────────────
-- db/equipe/003_visibilidade.sql
-- W4: Quem vé a reunião (padrão toda a Welcome)
--
-- Colunas novas:
--   - meetings.visibilidade ('todos' | 'so_eu' | 'escolhidos')
--   - users.visibilidade_padrao ('todos' | 'so_eu')
--
-- Tabela nova:
--   - meeting_acessos (meeting_id, user_id null, time_id text null)
--     para acesso explícito por pessoa ou time
--
-- Políticas RLS NOVAS:
--   - SELECT em meetings/tarefas: dono OR visibilidade='todos' OR
--     acesso por usuário OR acesso por time
--   - UPDATE/DELETE em meetings/tarefas: dono apenas (políticas existentes)
--
-- Aplicar APÓS: 0007_multitenant.sql + 002_sso_liberar.sql
--
-- Idempotente: IF NOT EXISTS / DROP IF EXISTS
-- ─────────────────────────────────────────────────────────────────────

-- ─── Coluna visibilidade em meetings ───────────────────────────────────
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS visibilidade TEXT NOT NULL DEFAULT 'todos'
  CHECK (visibilidade IN ('todos', 'so_eu', 'escolhidos'));

-- ─── Coluna visibilidade_padrao em users ──────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS visibilidade_padrao TEXT NOT NULL DEFAULT 'todos'
  CHECK (visibilidade_padrao IN ('todos', 'so_eu'));

-- ─── Tabela meeting_acessos: acesso explícito por pessoa ou time ───────
CREATE TABLE IF NOT EXISTS meeting_acessos (
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  time_id    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  CHECK (user_id IS NOT NULL OR time_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_acessos_unico
  ON meeting_acessos (meeting_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::UUID), COALESCE(time_id, ''));

CREATE INDEX IF NOT EXISTS idx_meeting_acessos_user
  ON meeting_acessos(user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_acessos_time
  ON meeting_acessos(time_id) WHERE time_id IS NOT NULL;

-- RLS em meeting_acessos: leitura permite ao dono da reunião e aos que têm acesso
-- Escrita só do admin ou dono da reunião (via aplicação)
ALTER TABLE meeting_acessos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_acessos_tenant ON meeting_acessos;
DROP POLICY IF EXISTS meeting_acessos_read ON meeting_acessos;

-- Apenas app_writer (n8n/voice-svc) pode gerenciar, via propagação de user_id
-- No app_tenant, leitura é feita via query ad-hoc com `withTenant()`
CREATE POLICY meeting_acessos_tenant ON meeting_acessos
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_acessos.meeting_id
        AND m.user_id::text = current_setting('app.current_user_id', true)
    )
  );

-- ─── Políticas NOVAS de leitura (SELECT) em meetings ────────────────────

DROP POLICY IF EXISTS meetings_read ON meetings;
DROP POLICY IF EXISTS meetings_write ON meetings;

-- SELECT: dono OU (visibilidade='todos') OU acesso explícito
-- Quem pode ler reunião alheia (só com a marca de leitura da equipe).
-- SECURITY DEFINER: lê meeting_acessos sem passar pela política dela, senão
-- meetings -> meeting_acessos -> meetings vira recursão infinita.
CREATE OR REPLACE FUNCTION equipe_pode_ler(p_meeting UUID, p_visibilidade TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_setting('app.leitura_equipe', true) = '1'
    AND (
      p_visibilidade = 'todos'
      OR EXISTS (
        SELECT 1 FROM meeting_acessos ma
        WHERE ma.meeting_id = p_meeting
          AND ma.user_id::text = current_setting('app.current_user_id', true)
      )
      OR EXISTS (
        SELECT 1
        FROM meeting_acessos ma
        JOIN users u ON u.id::text = current_setting('app.current_user_id', true)
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u.times, '[]'::jsonb)) t
        WHERE ma.meeting_id = p_meeting
          AND ma.time_id IS NOT NULL
          AND ma.time_id = t->>'id'
      )
    )
$$;
REVOKE ALL ON FUNCTION equipe_pode_ler(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION equipe_pode_ler(UUID, TEXT) TO app_tenant, app_writer;

CREATE POLICY meetings_read ON meetings
  FOR SELECT
  USING (equipe_pode_ler(id, visibilidade));

DROP POLICY IF EXISTS tarefas_read ON tarefas;
CREATE POLICY tarefas_read ON tarefas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = tarefas.meeting_id
        AND equipe_pode_ler(m.id, m.visibilidade)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_acessos TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_acessos TO app_writer;

-- ─── Trigger: aplicar visibilidade padrão na criação da reunião ────────
DROP FUNCTION IF EXISTS apply_default_visibilidade() CASCADE;

CREATE OR REPLACE FUNCTION apply_default_visibilidade()
RETURNS TRIGGER AS $$
DECLARE
  padrao TEXT;
BEGIN
  -- Busca a preferência padrão do usuário
  SELECT visibilidade_padrao INTO padrao
  FROM users
  WHERE id = NEW.user_id::uuid;

  -- Só quando ninguém escolheu: usa o padrão da pessoa (ou toda a Welcome)
  IF NEW.visibilidade IS NULL THEN
    NEW.visibilidade := COALESCE(padrao, 'todos');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE meetings ALTER COLUMN visibilidade DROP DEFAULT;

CREATE TRIGGER apply_default_visibilidade_trigger
BEFORE INSERT ON meetings
FOR EACH ROW
EXECUTE FUNCTION apply_default_visibilidade();

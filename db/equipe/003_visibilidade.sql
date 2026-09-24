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
  PRIMARY KEY (meeting_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::UUID), COALESCE(time_id, ''))
);

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
CREATE POLICY meetings_read ON meetings
  FOR SELECT
  USING (
    user_id::text = current_setting('app.current_user_id', true)  -- Dono
    OR visibilidade = 'todos'  -- Visível para todos
    OR EXISTS (
      -- Acesso explícito por user_id
      SELECT 1 FROM meeting_acessos
      WHERE meeting_acessos.meeting_id = meetings.id
        AND meeting_acessos.user_id::text = current_setting('app.current_user_id', true)
    )
    OR EXISTS (
      -- Acesso explícito por time (usuário atual tem um desses times)
      SELECT 1 FROM meeting_acessos ma
      WHERE ma.meeting_id = meetings.id
        AND ma.time_id IS NOT NULL
        AND ma.time_id = ANY(
          COALESCE(
            (SELECT array_agg(t->>'id')
             FROM users u, jsonb_array_elements(u.times) t
             WHERE u.id::text = current_setting('app.current_user_id', true)),
            '[]'::TEXT[]
          )
        )
    )
  );

-- INSERT/UPDATE/DELETE: dono apenas (preserva comportamento atual)
CREATE POLICY meetings_write ON meetings
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

-- ─── Políticas NOVAS de leitura (SELECT) em tarefas ────────────────────

DROP POLICY IF EXISTS tarefas_read ON tarefas;
DROP POLICY IF EXISTS tarefas_write ON tarefas;

-- SELECT: dono OU (reunião visível para mim)
CREATE POLICY tarefas_read ON tarefas
  FOR SELECT
  USING (
    user_id::text = current_setting('app.current_user_id', true)  -- Dono
    OR (
      -- Tarefa herda visibilidade via reunião
      EXISTS (
        SELECT 1 FROM meetings m
        WHERE m.id = tarefas.meeting_id
          AND (
            m.user_id::text = current_setting('app.current_user_id', true)  -- Dono da reunião
            OR m.visibilidade = 'todos'  -- Reunião visível para todos
            OR EXISTS (
              -- Acesso explícito à reunião por user_id
              SELECT 1 FROM meeting_acessos
              WHERE meeting_acessos.meeting_id = m.id
                AND meeting_acessos.user_id::text = current_setting('app.current_user_id', true)
            )
            OR EXISTS (
              -- Acesso explícito à reunião por time
              SELECT 1 FROM meeting_acessos ma
              WHERE ma.meeting_id = m.id
                AND ma.time_id IS NOT NULL
                AND ma.time_id = ANY(
                  COALESCE(
                    (SELECT array_agg(t->>'id')
                     FROM users u, jsonb_array_elements(u.times) t
                     WHERE u.id::text = current_setting('app.current_user_id', true)),
                    '[]'::TEXT[]
                  )
                )
            )
          )
      )
    )
  );

-- INSERT/UPDATE/DELETE: dono apenas (preserva comportamento atual)
CREATE POLICY tarefas_write ON tarefas
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

-- ─── Grants para meeting_acessos ───────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_acessos TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_acessos TO app_writer;

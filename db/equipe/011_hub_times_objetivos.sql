-- Só no banco da equipe (acoes-equipe).
-- Pedido do Vitor (28/09/2026): o Ações vira "um hub de tarefas individuais e de times, que pode
-- ser separado por projetos, objetivos e etc, onde o gerenciamento deve ser MUITO fácil".
--
-- Modelo (no mesmo desenho do 008: o RLS de cada tabela continua fechado no dono; quem entra por
-- time, projeto ou objetivo passa pelas funções abaixo, e o app age no tenant do dono):
--   - tarefas.time_id: ação do time (id do time do TTARS). Todo mundo do time vê e mexe.
--   - quadros.time_id: projeto do time. Todo mundo do time entra nele.
--   - objetivos: meta com "até quando" e "como medir"; quem vê: só eu, um time ou toda a Welcome.
--     Projetos e ações se ligam a ele (quadros.objetivo_id, tarefas.objetivo_id).
--   - acoes_listas: o filtro que a pessoa montou, guardado com nome (vira item do menu dela).
-- Administrador (users.is_admin) enxerga todos os times (opção 1 do Vitor, 28/09).

BEGIN;

-- ─── Colunas novas ───────────────────────────────────────────────────

ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS time_id TEXT;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS objetivo_id UUID;
ALTER TABLE quadros ADD COLUMN IF NOT EXISTS time_id TEXT;
ALTER TABLE quadros ADD COLUMN IF NOT EXISTS objetivo_id UUID;

CREATE INDEX IF NOT EXISTS idx_tarefas_time ON tarefas(time_id) WHERE time_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarefas_objetivo ON tarefas(objetivo_id) WHERE objetivo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quadros_time ON quadros(time_id) WHERE time_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quadros_objetivo ON quadros(objetivo_id) WHERE objetivo_id IS NOT NULL;

-- ─── Objetivos ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS objetivos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 200),
  como_medir   TEXT CHECK (como_medir IS NULL OR length(como_medir) <= 2000),
  prazo        DATE,
  visibilidade TEXT NOT NULL DEFAULT 'so_eu' CHECK (visibilidade IN ('so_eu', 'time', 'todos')),
  time_id      TEXT,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT objetivos_time_quando_time CHECK (visibilidade <> 'time' OR time_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_objetivos_user ON objetivos(user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tarefas_objetivo_fk') THEN
    ALTER TABLE tarefas ADD CONSTRAINT tarefas_objetivo_fk
      FOREIGN KEY (objetivo_id) REFERENCES objetivos(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quadros_objetivo_fk') THEN
    ALTER TABLE quadros ADD CONSTRAINT quadros_objetivo_fk
      FOREIGN KEY (objetivo_id) REFERENCES objetivos(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE objetivos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS objetivos_tenant ON objetivos;
CREATE POLICY objetivos_tenant ON objetivos FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

-- ─── Listas salvas ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acoes_listas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  onde       TEXT NOT NULL CHECK (onde ~ '^(minhas|(time|projeto|objetivo):[A-Za-z0-9_-]{1,80})$'),
  filtro     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filtro) = 'object' AND length(filtro::text) <= 8000),
  ordem      TEXT CHECK (ordem IS NULL OR ordem IN ('prazo', 'criada', 'pessoa', 'projeto', 'situacao')),
  vista      TEXT CHECK (vista IS NULL OR vista IN ('lista', 'quadro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acoes_listas_user ON acoes_listas(user_id);

ALTER TABLE acoes_listas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acoes_listas_tenant ON acoes_listas;
CREATE POLICY acoes_listas_tenant ON acoes_listas FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

-- O Supabase dá acesso automático a anon/authenticated em tabela nova: aqui ninguém de fora lê.
REVOKE ALL ON objetivos, acoes_listas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON objetivos, acoes_listas TO app_tenant, app_writer;

-- ─── Times ───────────────────────────────────────────────────────────

-- Times do TTARS de quem pergunta (ttars_pessoas.times do e-mail dele).
CREATE OR REPLACE FUNCTION equipe_meus_times() RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(ARRAY_AGG(DISTINCT t->>'id') FILTER (WHERE t->>'id' IS NOT NULL), '{}'::text[])
    FROM users u
    JOIN ttars_pessoas p ON p.email = LOWER(u.email)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.times) = 'array' THEN p.times ELSE '[]'::jsonb END) t
   WHERE u.id = equipe_eu() AND u.deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION equipe_sou_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT u.is_admin FROM users u WHERE u.id = equipe_eu() AND u.deleted_at IS NULL), false)
$$;

-- Pode ver e usar este time: é do time, ou é administrador.
CREATE OR REPLACE FUNCTION equipe_pode_time(p_time TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_time IS NOT NULL AND equipe_eu() IS NOT NULL
     AND (equipe_sou_admin() OR p_time = ANY (equipe_meus_times()))
$$;

-- Ações do time (de qualquer dono).
CREATE OR REPLACE FUNCTION equipe_tarefas_do_time(p_time TEXT) RETURNS TABLE (tarefa_id UUID, dono_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.user_id FROM tarefas t
   WHERE t.time_id = p_time AND equipe_pode_time(p_time)
$$;

-- Quantas ações abertas cada time tem (só dos times que quem pergunta pode ver).
CREATE OR REPLACE FUNCTION equipe_resumo_times(p_times TEXT[]) RETURNS TABLE (time_id TEXT, abertas INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.time_id, COUNT(*)::int FROM tarefas t
   WHERE t.time_id = ANY (p_times) AND equipe_pode_time(t.time_id)
     AND t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao')
   GROUP BY t.time_id
$$;

-- ─── Projetos (008 + time) ───────────────────────────────────────────

-- Versão anterior: 008. Mudança: projeto do time entra para quem pode ver o time.
CREATE OR REPLACE FUNCTION equipe_pode_projeto(p_quadro UUID, p_user UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM quadros q
     WHERE q.id = p_quadro AND q.archived_at IS NULL
       AND (q.user_id = p_user
            OR EXISTS (SELECT 1 FROM quadro_membros m WHERE m.quadro_id = q.id AND m.user_id = p_user)
            OR (q.time_id IS NOT NULL AND p_user = equipe_eu() AND equipe_pode_time(q.time_id)))
  )
$$;

-- Projetos do time (de qualquer dono).
CREATE OR REPLACE FUNCTION equipe_projetos_do_time(p_time TEXT) RETURNS TABLE (quadro_id UUID, dono_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.user_id FROM quadros q
   WHERE q.time_id = p_time AND q.archived_at IS NULL AND equipe_pode_time(p_time)
$$;

-- Quantas ações abertas, feitas e vencidas cada projeto tem, e o próximo prazo que ainda não venceu.
CREATE OR REPLACE FUNCTION equipe_resumo_projetos(p_ids UUID[])
RETURNS TABLE (quadro_id UUID, abertas INT, feitas INT, vencidas INT, proximo_prazo TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id,
         (COUNT(t.id) FILTER (WHERE t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao')))::int,
         (COUNT(t.id) FILTER (WHERE t.status = 'concluida'))::int,
         (COUNT(t.id) FILTER (WHERE t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao') AND t.prazo < now()))::int,
         MIN(t.prazo) FILTER (WHERE t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao') AND t.prazo >= now())
    FROM quadros q
    LEFT JOIN quadro_tarefas qt ON qt.quadro_id = q.id
    LEFT JOIN tarefas t ON t.id = qt.tarefa_id
   WHERE q.id = ANY (p_ids) AND equipe_pode_projeto(q.id, equipe_eu())
   GROUP BY q.id
$$;

-- ─── Tarefas (008 + time) ────────────────────────────────────────────

-- Versão anterior: 008. Mudança: papel 'time' (ação do time que quem pergunta pode ver).
CREATE OR REPLACE FUNCTION equipe_acesso_tarefa(p_tarefa UUID) RETURNS TABLE (dono_id UUID, papel TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.user_id,
         CASE WHEN t.user_id = equipe_eu() THEN 'dono'
              WHEN t.responsavel_user_id = equipe_eu() THEN 'responsavel'
              WHEN EXISTS (SELECT 1 FROM quadro_tarefas qt
                            WHERE qt.tarefa_id = t.id AND equipe_pode_projeto(qt.quadro_id, equipe_eu())) THEN 'projeto'
              ELSE 'time' END
    FROM tarefas t
   WHERE t.id = p_tarefa
     AND equipe_eu() IS NOT NULL
     AND (t.user_id = equipe_eu()
          OR t.responsavel_user_id = equipe_eu()
          OR EXISTS (SELECT 1 FROM quadro_tarefas qt
                      WHERE qt.tarefa_id = t.id AND equipe_pode_projeto(qt.quadro_id, equipe_eu()))
          OR (t.time_id IS NOT NULL AND equipe_pode_time(t.time_id)))
$$;

-- Versão anterior: 008. Mudança: ação do time também é "vista por outros" (apagar a reunião
-- não pode sumir com ela).
CREATE OR REPLACE FUNCTION equipe_tarefas_com_outros(p_ids UUID[]) RETURNS TABLE (tarefa_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id FROM tarefas t
   WHERE t.id = ANY(p_ids) AND t.user_id = equipe_eu()
     AND ((t.responsavel_user_id IS NOT NULL AND t.responsavel_user_id <> t.user_id)
          OR t.time_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM quadro_tarefas qt JOIN quadros q ON q.id = qt.quadro_id
                      WHERE qt.tarefa_id = t.id AND q.archived_at IS NULL
                        AND (q.user_id <> t.user_id
                             OR q.time_id IS NOT NULL
                             OR EXISTS (SELECT 1 FROM quadro_membros m
                                         WHERE m.quadro_id = q.id AND m.user_id <> t.user_id))))
$$;

-- ─── Objetivos: quem vê ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION equipe_pode_objetivo(p_objetivo UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT equipe_eu() IS NOT NULL AND EXISTS (
    SELECT 1 FROM objetivos o
     WHERE o.id = p_objetivo AND o.archived_at IS NULL
       AND (o.user_id = equipe_eu()
            OR o.visibilidade = 'todos'
            OR (o.visibilidade = 'time' AND equipe_pode_time(o.time_id)))
  )
$$;

-- Dono do objetivo, se quem pergunta pode vê-lo (o app age no tenant dele).
CREATE OR REPLACE FUNCTION equipe_objetivo_dono(p_objetivo UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.user_id FROM objetivos o WHERE o.id = p_objetivo AND equipe_pode_objetivo(o.id)
$$;

-- Os objetivos que quem pergunta vê (os dele e os abertos a ele), com o que a tela mostra.
CREATE OR REPLACE FUNCTION equipe_objetivos_visiveis()
RETURNS TABLE (id UUID, user_id UUID, nome TEXT, como_medir TEXT, prazo DATE, visibilidade TEXT,
               time_id TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.user_id, o.nome, o.como_medir, o.prazo, o.visibilidade, o.time_id, o.created_at
    FROM objetivos o
   WHERE equipe_pode_objetivo(o.id)
$$;

-- Ações do objetivo: ligadas direto ou num projeto ligado a ele — só as que quem pergunta pode ver.
CREATE OR REPLACE FUNCTION equipe_tarefas_do_objetivo(p_objetivo UUID) RETURNS TABLE (tarefa_id UUID, dono_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.user_id FROM tarefas t
   WHERE equipe_pode_objetivo(p_objetivo)
     AND (t.objetivo_id = p_objetivo
          OR EXISTS (SELECT 1 FROM quadro_tarefas qt JOIN quadros q ON q.id = qt.quadro_id
                      WHERE qt.tarefa_id = t.id AND q.objetivo_id = p_objetivo AND q.archived_at IS NULL))
     AND EXISTS (SELECT 1 FROM equipe_acesso_tarefa(t.id))
$$;

-- Projetos ligados ao objetivo que quem pergunta vê.
CREATE OR REPLACE FUNCTION equipe_projetos_do_objetivo(p_objetivo UUID) RETURNS TABLE (quadro_id UUID, dono_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.user_id FROM quadros q
   WHERE q.objetivo_id = p_objetivo AND q.archived_at IS NULL
     AND equipe_pode_objetivo(p_objetivo) AND equipe_pode_projeto(q.id, equipe_eu())
$$;

-- Números de cada objetivo, contados sobre as mesmas ações que a tela mostra (contador e lista
-- da mesma fonte). Canceladas não entram no total.
CREATE OR REPLACE FUNCTION equipe_resumo_objetivos(p_ids UUID[])
RETURNS TABLE (objetivo_id UUID, total INT, feitas INT, vencidas INT, n_projetos INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id,
         (SELECT COUNT(*) FROM equipe_tarefas_do_objetivo(o.id) x JOIN tarefas t ON t.id = x.tarefa_id
           WHERE t.status <> 'cancelada')::int,
         (SELECT COUNT(*) FROM equipe_tarefas_do_objetivo(o.id) x JOIN tarefas t ON t.id = x.tarefa_id
           WHERE t.status = 'concluida')::int,
         (SELECT COUNT(*) FROM equipe_tarefas_do_objetivo(o.id) x JOIN tarefas t ON t.id = x.tarefa_id
           WHERE t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao') AND t.prazo < now())::int,
         (SELECT COUNT(*) FROM equipe_projetos_do_objetivo(o.id))::int
    FROM objetivos o
   WHERE o.id = ANY (p_ids) AND equipe_pode_objetivo(o.id)
$$;

-- Nome dos objetivos (para o selo na ação) — só os que quem pergunta vê.
CREATE OR REPLACE FUNCTION equipe_objetivos_nomes(p_ids UUID[]) RETURNS TABLE (id UUID, nome TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.nome FROM objetivos o WHERE o.id = ANY (p_ids) AND equipe_pode_objetivo(o.id)
$$;

-- ─── Permissões das funções ──────────────────────────────────────────

DO $$
DECLARE f TEXT;
BEGIN
  -- Interna (como no 008): só as outras funções chamam.
  REVOKE ALL ON FUNCTION equipe_pode_projeto(uuid, uuid) FROM PUBLIC, anon, authenticated;
  FOREACH f IN ARRAY ARRAY[
    'equipe_meus_times()', 'equipe_sou_admin()', 'equipe_pode_time(text)',
    'equipe_tarefas_do_time(text)', 'equipe_resumo_times(text[])',
    'equipe_projetos_do_time(text)', 'equipe_resumo_projetos(uuid[])', 'equipe_acesso_tarefa(uuid)',
    'equipe_tarefas_com_outros(uuid[])', 'equipe_pode_objetivo(uuid)', 'equipe_objetivo_dono(uuid)',
    'equipe_objetivos_visiveis()', 'equipe_tarefas_do_objetivo(uuid)', 'equipe_projetos_do_objetivo(uuid)',
    'equipe_resumo_objetivos(uuid[])', 'equipe_objetivos_nomes(uuid[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_tenant', f);
  END LOOP;
END $$;

COMMIT;

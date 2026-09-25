-- Só no banco da equipe (acoes-equipe).
-- Pedido do Vitor (25/09/2026): "Quero que o Ações seja um Hub de atividades. Então as
-- tarefas das reuniões criadas devem poder ser compartilhadas entre as pessoas, pra elas
-- colocarem em projetos e coisas do tipo."
--
-- Modelo (sem afrouxar o RLS de tarefas):
--   - tarefa passada a um colega: tarefas.responsavel_user_id → aparece na lista dele;
--   - projeto = quadro com pessoas: quadro_membros → todos do projeto veem e mexem nas
--     tarefas dele;
--   - a tarefa continua de quem a criou (tarefas.user_id). Quem entra por colega ou por
--     projeto passa pelas funções abaixo (SECURITY DEFINER, leem app.current_user_id) e o
--     app então age no tenant do dono da tarefa, como o link de convidado já faz.

BEGIN;

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS responsavel_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tarefas_responsavel
  ON tarefas(responsavel_user_id) WHERE responsavel_user_id IS NOT NULL;

-- Quem mexeu, quando não foi o dono da tarefa.
ALTER TABLE tarefa_eventos
  ADD COLUMN IF NOT EXISTS ator_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS quadro_membros (
  quadro_id      UUID NOT NULL REFERENCES quadros(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adicionado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quadro_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_quadro_membros_user ON quadro_membros(user_id);

-- Escrita só pelo tenant do dono do projeto (o app entra como ele depois de conferir).
ALTER TABLE quadro_membros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadro_membros_tenant ON quadro_membros;
CREATE POLICY quadro_membros_tenant ON quadro_membros FOR ALL
  USING (EXISTS (SELECT 1 FROM quadros q WHERE q.id = quadro_membros.quadro_id));
REVOKE ALL ON quadro_membros FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON quadro_membros TO app_tenant, app_writer;

-- ─── Funções de acesso ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION equipe_eu() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Interna: p_user é dono ou pessoa do projeto (e o projeto não foi arquivado).
CREATE OR REPLACE FUNCTION equipe_pode_projeto(p_quadro UUID, p_user UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM quadros q
     WHERE q.id = p_quadro AND q.archived_at IS NULL
       AND (q.user_id = p_user
            OR EXISTS (SELECT 1 FROM quadro_membros m WHERE m.quadro_id = q.id AND m.user_id = p_user))
  )
$$;

-- Dono do projeto, se quem pergunta está nele.
CREATE OR REPLACE FUNCTION equipe_projeto_dono(p_quadro UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.user_id FROM quadros q
   WHERE q.id = p_quadro AND equipe_pode_projeto(q.id, equipe_eu())
$$;

-- Projetos de quem pergunta: os dele e os em que foi chamado.
CREATE OR REPLACE FUNCTION equipe_meus_projetos() RETURNS TABLE (quadro_id UUID, dono_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.user_id FROM quadros q
   WHERE q.archived_at IS NULL AND equipe_pode_projeto(q.id, equipe_eu())
$$;

-- Tarefas de um projeto em que quem pergunta está, com o dono de cada uma.
CREATE OR REPLACE FUNCTION equipe_tarefas_do_projeto(p_quadro UUID)
RETURNS TABLE (tarefa_id UUID, dono_id UUID, ordem INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT qt.tarefa_id, t.user_id, qt.ordem
    FROM quadro_tarefas qt JOIN tarefas t ON t.id = qt.tarefa_id
   WHERE qt.quadro_id = p_quadro AND equipe_pode_projeto(p_quadro, equipe_eu())
$$;

-- Pode mexer nesta tarefa? Devolve o dono dela e o porquê
-- ('dono' = criou; 'responsavel' = foi passada a quem pergunta; 'projeto' = está num projeto dele).
CREATE OR REPLACE FUNCTION equipe_acesso_tarefa(p_tarefa UUID) RETURNS TABLE (dono_id UUID, papel TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.user_id,
         CASE WHEN t.user_id = equipe_eu() THEN 'dono'
              WHEN t.responsavel_user_id = equipe_eu() THEN 'responsavel'
              ELSE 'projeto' END
    FROM tarefas t
   WHERE t.id = p_tarefa
     AND equipe_eu() IS NOT NULL
     AND (t.user_id = equipe_eu()
          OR t.responsavel_user_id = equipe_eu()
          OR EXISTS (SELECT 1 FROM quadro_tarefas qt
                      WHERE qt.tarefa_id = t.id AND equipe_pode_projeto(qt.quadro_id, equipe_eu())))
$$;

-- Tarefas que colegas passaram para quem pergunta.
CREATE OR REPLACE FUNCTION equipe_tarefas_para_mim() RETURNS TABLE (tarefa_id UUID, dono_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.user_id FROM tarefas t
   WHERE t.responsavel_user_id = equipe_eu() AND t.user_id <> equipe_eu()
$$;

-- Em quais projetos (de quem pergunta) estão estas tarefas.
CREATE OR REPLACE FUNCTION equipe_projetos_das_tarefas(p_ids UUID[])
RETURNS TABLE (tarefa_id UUID, quadro_id UUID, nome TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT qt.tarefa_id, q.id, q.nome
    FROM quadro_tarefas qt JOIN quadros q ON q.id = qt.quadro_id
   WHERE qt.tarefa_id = ANY(p_ids) AND equipe_pode_projeto(q.id, equipe_eu())
   ORDER BY q.nome
$$;

-- Pessoas de um projeto em que quem pergunta está (o dono primeiro).
CREATE OR REPLACE FUNCTION equipe_pessoas_do_projeto(p_quadro UUID)
RETURNS TABLE (user_id UUID, nome TEXT, e_dono BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.user_id, u.nome, true
    FROM quadros q JOIN users u ON u.id = q.user_id
   WHERE q.id = p_quadro AND equipe_pode_projeto(p_quadro, equipe_eu())
  UNION ALL
  SELECT m.user_id, u.nome, false
    FROM quadro_membros m JOIN users u ON u.id = m.user_id
   WHERE m.quadro_id = p_quadro AND equipe_pode_projeto(p_quadro, equipe_eu())
$$;

-- Entre estas tarefas de quem pergunta, as que outra pessoa também vê (passadas a colega
-- ou num projeto com mais gente). Apagar a reunião não pode sumir com elas.
CREATE OR REPLACE FUNCTION equipe_tarefas_com_outros(p_ids UUID[]) RETURNS TABLE (tarefa_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id FROM tarefas t
   WHERE t.id = ANY(p_ids) AND t.user_id = equipe_eu()
     AND ((t.responsavel_user_id IS NOT NULL AND t.responsavel_user_id <> t.user_id)
          OR EXISTS (SELECT 1 FROM quadro_tarefas qt JOIN quadros q ON q.id = qt.quadro_id
                      WHERE qt.tarefa_id = t.id AND q.archived_at IS NULL
                        AND (q.user_id <> t.user_id
                             OR EXISTS (SELECT 1 FROM quadro_membros m
                                         WHERE m.quadro_id = q.id AND m.user_id <> t.user_id))))
$$;

REVOKE ALL ON FUNCTION equipe_tarefas_com_outros(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION equipe_tarefas_com_outros(UUID[]) TO app_tenant;
REVOKE ALL ON FUNCTION equipe_pode_projeto(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION equipe_projeto_dono(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION equipe_meus_projetos() FROM PUBLIC;
REVOKE ALL ON FUNCTION equipe_tarefas_do_projeto(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION equipe_acesso_tarefa(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION equipe_tarefas_para_mim() FROM PUBLIC;
REVOKE ALL ON FUNCTION equipe_projetos_das_tarefas(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION equipe_pessoas_do_projeto(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION equipe_projeto_dono(UUID) TO app_tenant;
GRANT EXECUTE ON FUNCTION equipe_meus_projetos() TO app_tenant;
GRANT EXECUTE ON FUNCTION equipe_tarefas_do_projeto(UUID) TO app_tenant;
GRANT EXECUTE ON FUNCTION equipe_acesso_tarefa(UUID) TO app_tenant;
GRANT EXECUTE ON FUNCTION equipe_tarefas_para_mim() TO app_tenant;
GRANT EXECUTE ON FUNCTION equipe_projetos_das_tarefas(UUID[]) TO app_tenant;
GRANT EXECUTE ON FUNCTION equipe_pessoas_do_projeto(UUID) TO app_tenant;
GRANT EXECUTE ON FUNCTION equipe_eu() TO app_tenant;

COMMIT;

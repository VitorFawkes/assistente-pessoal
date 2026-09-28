-- Só no banco da equipe (acoes-equipe).
-- Pedido do Vitor (28/09/2026): "todas as ações geradas ficam só pras pessoas que estavam naquela reunião.
-- Se quiser que outras pessoas ou o time vejam, marca o time ou as pessoas."
--
-- Reunião:  quem vê = quem gravou + QUEM ESTAVA (convidado do Teams, voz reconhecida em "Quem falou", ou marcado por
--           quem gravou) + quem foi MARCADO (pessoa ou time). "Só eu" fecha para todos; "Toda a Welcome" abre.
--           Reunião nova nasce "escolhidos" (= quem estava + marcados). Reunião antiga fica como está.
-- Ação:     além de dono, quem faz, projeto e time, as PESSOAS MARCADAS nela (tarefa_acessos) veem e mexem.
--
-- REBASE-REVISADO: equipe_pode_ler <- 003; apply_default_visibilidade <- 003, 006, 007; copiar_acessos_do_pai <- 006;
--   equipe_chamado_na_reuniao <- 010; equipe_posso_puxar <- 010; equipe_acesso_tarefa <- 008, 011;
--   equipe_tarefas_com_outros <- 008, 011.
-- Sem DROP. Idempotente (pode rodar de novo).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ─── 1. Por que a pessoa vê a reunião ─────────────────────────────────────────────────────────
-- convidado = estava no convite do Teams; falou = voz em "Quem falou"; estava = quem gravou marcou;
-- quem_ve = marcada para ver (pessoa ou time). Uma linha por pessoa: quem estava vale mais que marcada.
ALTER TABLE meeting_acessos ADD COLUMN IF NOT EXISTS motivo TEXT NOT NULL DEFAULT 'quem_ve';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meeting_acessos_motivo_check') THEN
    ALTER TABLE meeting_acessos ADD CONSTRAINT meeting_acessos_motivo_check
      CHECK (motivo IN ('convidado', 'falou', 'estava', 'quem_ve'));
  END IF;
END $$;

-- Convidados do Teams que já estão nas reuniões viram "convidado" (o resto segue "marcada").
UPDATE meeting_acessos ma
   SET motivo = 'convidado'
  FROM meetings m, users u
 WHERE ma.meeting_id = m.id AND m.source = 'teams' AND ma.motivo = 'quem_ve'
   AND ma.user_id = u.id AND LOWER(u.email) = ANY (COALESCE(m.teams_convidados, '{}'::text[]));

-- ─── 2. Quem lê a reunião (e as ações dela) ───────────────────────────────────────────────────
-- Versão anterior: 003. Mudanças: respeita a visibilidade ("Só eu" fecha mesmo com linhas guardadas; as linhas de
-- quem estava não se perdem ao fechar e reabrir) e o time vale pela lista certa por empresa + administradores
-- (equipe_pode_time, 011) em vez de users.times, que cada entrada refazia só com a empresa ativa.
CREATE OR REPLACE FUNCTION equipe_pode_ler(p_meeting UUID, p_visibilidade TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_setting('app.leitura_equipe', true) = '1'
    AND (
      p_visibilidade = 'todos'
      OR (
        p_visibilidade = 'escolhidos'
        AND (
          EXISTS (
            SELECT 1 FROM meeting_acessos ma
             WHERE ma.meeting_id = p_meeting
               AND ma.user_id::text = current_setting('app.current_user_id', true)
          )
          OR EXISTS (
            SELECT 1 FROM meeting_acessos ma
             WHERE ma.meeting_id = p_meeting AND ma.time_id IS NOT NULL AND equipe_pode_time(ma.time_id)
          )
        )
      )
    )
$$;
REVOKE ALL ON FUNCTION equipe_pode_ler(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION equipe_pode_ler(UUID, TEXT) TO app_tenant, app_writer;

-- ─── 3. Reunião nova nasce "quem estava + marcados" ───────────────────────────────────────────
-- Versão anterior: 007. Mudança: sem escolha, nasce "escolhidos" (quem estava vê); quem escolheu "Toda a Welcome"
-- como padrão continua com isso. Pedaço de reunião herda do pai.
CREATE OR REPLACE FUNCTION apply_default_visibilidade()
RETURNS TRIGGER AS $$
DECLARE
  padrao TEXT;
BEGIN
  IF NEW.visibilidade IS NULL AND NEW.parent_meeting_id IS NOT NULL THEN
    SELECT visibilidade INTO NEW.visibilidade FROM meetings WHERE id = NEW.parent_meeting_id;
  END IF;

  SELECT visibilidade_padrao INTO padrao
  FROM users
  WHERE id = NEW.user_id::uuid;

  IF NEW.visibilidade IS NULL THEN
    NEW.visibilidade := CASE WHEN padrao = 'todos' THEN 'todos' ELSE 'escolhidos' END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Versão anterior: 006. Mudança: o pedaço guarda também o motivo de cada acesso.
CREATE OR REPLACE FUNCTION copiar_acessos_do_pai()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO meeting_acessos (meeting_id, user_id, time_id, created_by, motivo)
  SELECT NEW.id, ma.user_id, ma.time_id, ma.created_by, ma.motivo
  FROM meeting_acessos ma
  WHERE ma.meeting_id = NEW.parent_meeting_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 4. "Quem falou" vira "quem estava" ───────────────────────────────────────────────────────
-- Computador e celular: cada nome das vozes que é de UMA pessoa da Welcome (mesmo nome da lista do TTARS; nome repetido não liga) entra
-- como "falou". Quem sai das vozes (nome trocado) sai também — só as linhas "falou"; convidado, marcado por quem
-- gravou e marcado para ver ficam. Nunca quem gravou. Só com a reunião em "escolhidos" ("Só eu" e "Toda a Welcome"
-- não mexem; ao voltar para "escolhidos", roda de novo).
CREATE OR REPLACE FUNCTION equipe_vozes_viram_quem_estava()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids UUID[];
BEGIN
  -- Reunião do Teams: quem estava vem do convite (teams-receber.ts), que já deixa de fora quem gravou a mesma
  -- reunião pelo Ações (essa pessoa tem a dela).
  IF NEW.visibilidade IS DISTINCT FROM 'escolhidos' OR NEW.source = 'teams' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.speaker_labels IS NOT DISTINCT FROM OLD.speaker_labels
     AND NEW.visibilidade IS NOT DISTINCT FROM OLD.visibilidade THEN
    RETURN NEW;
  END IF;

  WITH nomes AS (
    SELECT DISTINCT LOWER(REGEXP_REPLACE(BTRIM(e.v), '\s+', ' ', 'g')) AS n
      FROM jsonb_each_text(CASE WHEN jsonb_typeof(NEW.speaker_labels) = 'object' THEN NEW.speaker_labels ELSE '{}'::jsonb END) AS e(k, v)
     WHERE BTRIM(e.v) <> ''
  ),
  pessoas AS (
    SELECT p.email, p.nome, p.times
      FROM ttars_pessoas p
      JOIN nomes ON LOWER(REGEXP_REPLACE(BTRIM(p.nome), '\s+', ' ', 'g')) = nomes.n
     WHERE COALESCE(p.organizacao, '') <> ''
       AND (SELECT COUNT(*) FROM ttars_pessoas p2
             WHERE LOWER(REGEXP_REPLACE(BTRIM(p2.nome), '\s+', ' ', 'g')) = nomes.n
               AND COALESCE(p2.organizacao, '') <> '') = 1
  ),
  contas AS (
    -- Conta aqui de quem ainda não entrou (como garantirColegaDoTtars): vê quando for liberada no Ações.
    INSERT INTO users (nome, email, times, is_admin, consent_terms_at)
    SELECT nome, email, COALESCE(times, '[]'::jsonb), false, NULL FROM pessoas
    ON CONFLICT (email) WHERE email IS NOT NULL AND deleted_at IS NULL DO UPDATE SET nome = users.nome
    RETURNING id
  )
  SELECT ARRAY_AGG(id) INTO v_ids FROM contas WHERE id <> NEW.user_id;

  DELETE FROM meeting_acessos
   WHERE meeting_id = NEW.id AND motivo = 'falou'
     AND NOT (user_id = ANY (COALESCE(v_ids, '{}'::uuid[])));

  INSERT INTO meeting_acessos (meeting_id, user_id, motivo, created_by)
  SELECT NEW.id, x, 'falou', NEW.user_id FROM UNNEST(COALESCE(v_ids, '{}'::uuid[])) AS x
  ON CONFLICT (meeting_id, (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)), (COALESCE(time_id, '')))
  DO UPDATE SET motivo = 'falou' WHERE meeting_acessos.motivo = 'quem_ve';

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION equipe_vozes_viram_quem_estava() FROM PUBLIC;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'equipe_vozes_viram_quem_estava_trigger') THEN
    CREATE TRIGGER equipe_vozes_viram_quem_estava_trigger
    AFTER INSERT OR UPDATE OF speaker_labels, visibilidade ON meetings
    FOR EACH ROW EXECUTE FUNCTION equipe_vozes_viram_quem_estava();
  END IF;
END $$;

-- ─── 5. Puxar a ação vale em qualquer reunião ─────────────────────────────────────────────────
-- Versão anterior: 010. Mudança: quem estava ou foi marcado como pessoa, com a reunião não fechada em "Só eu".
CREATE OR REPLACE FUNCTION equipe_chamado_na_reuniao(p_meeting UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT equipe_eu() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM meeting_acessos ma JOIN meetings m ON m.id = ma.meeting_id
       WHERE ma.meeting_id = p_meeting AND ma.user_id = equipe_eu() AND m.visibilidade <> 'so_eu'
    )
    OR EXISTS (
      SELECT 1 FROM meetings m JOIN users u ON u.id = equipe_eu()
       WHERE m.id = p_meeting AND m.visibilidade = 'todos'
         AND LOWER(u.email) = ANY (COALESCE(m.teams_convidados, '{}'::text[]))
    )
  )
$$;

-- Versão anterior: 010. Mudança: não só reunião do Teams (computador e celular também têm quem estava).
CREATE OR REPLACE FUNCTION equipe_posso_puxar(p_tarefa UUID)
RETURNS TABLE (dono_id UUID, responsavel_id UUID, status TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.user_id, t.responsavel_user_id, t.status
    FROM tarefas t
   WHERE t.id = p_tarefa
     AND t.meeting_id IS NOT NULL
     AND t.user_id <> equipe_eu()
     AND equipe_chamado_na_reuniao(t.meeting_id)
$$;

-- ─── 6. Pessoas marcadas numa ação ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tarefa_acessos (
  tarefa_id  UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tarefa_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tarefa_acessos_user ON tarefa_acessos (user_id);

ALTER TABLE tarefa_acessos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tarefa_acessos' AND policyname = 'tarefa_acessos_tenant') THEN
    CREATE POLICY tarefa_acessos_tenant ON tarefa_acessos FOR ALL
      USING (EXISTS (SELECT 1 FROM tarefas t
                      WHERE t.id = tarefa_acessos.tarefa_id
                        AND t.user_id::text = current_setting('app.current_user_id', true)))
      WITH CHECK (EXISTS (SELECT 1 FROM tarefas t
                           WHERE t.id = tarefa_acessos.tarefa_id
                             AND t.user_id::text = current_setting('app.current_user_id', true)));
  END IF;
END $$;
REVOKE ALL ON tarefa_acessos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tarefa_acessos TO app_tenant, app_writer;

-- Versão anterior: 011 (008 antes). Mudança: papel 'pessoa' (marcada para ver a ação: vê e mexe como o time).
CREATE OR REPLACE FUNCTION equipe_acesso_tarefa(p_tarefa UUID) RETURNS TABLE (dono_id UUID, papel TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.user_id,
         CASE WHEN t.user_id = equipe_eu() THEN 'dono'
              WHEN t.responsavel_user_id = equipe_eu() THEN 'responsavel'
              WHEN EXISTS (SELECT 1 FROM quadro_tarefas qt
                            WHERE qt.tarefa_id = t.id AND equipe_pode_projeto(qt.quadro_id, equipe_eu())) THEN 'projeto'
              WHEN EXISTS (SELECT 1 FROM tarefa_acessos ta
                            WHERE ta.tarefa_id = t.id AND ta.user_id = equipe_eu()) THEN 'pessoa'
              ELSE 'time' END
    FROM tarefas t
   WHERE t.id = p_tarefa
     AND equipe_eu() IS NOT NULL
     AND (t.user_id = equipe_eu()
          OR t.responsavel_user_id = equipe_eu()
          OR EXISTS (SELECT 1 FROM quadro_tarefas qt
                      WHERE qt.tarefa_id = t.id AND equipe_pode_projeto(qt.quadro_id, equipe_eu()))
          OR EXISTS (SELECT 1 FROM tarefa_acessos ta WHERE ta.tarefa_id = t.id AND ta.user_id = equipe_eu())
          OR (t.time_id IS NOT NULL AND equipe_pode_time(t.time_id)))
$$;

-- Versão anterior: 011 (008 antes). Mudança: ação com pessoa marcada também é "vista por outros" (apagar a
-- reunião não pode sumir com ela).
CREATE OR REPLACE FUNCTION equipe_tarefas_com_outros(p_ids UUID[]) RETURNS TABLE (tarefa_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id FROM tarefas t
   WHERE t.id = ANY(p_ids) AND t.user_id = equipe_eu()
     AND ((t.responsavel_user_id IS NOT NULL AND t.responsavel_user_id <> t.user_id)
          OR t.time_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM tarefa_acessos ta WHERE ta.tarefa_id = t.id)
          OR EXISTS (SELECT 1 FROM quadro_tarefas qt JOIN quadros q ON q.id = qt.quadro_id
                      WHERE qt.tarefa_id = t.id AND q.archived_at IS NULL
                        AND (q.user_id <> t.user_id
                             OR q.time_id IS NOT NULL
                             OR EXISTS (SELECT 1 FROM quadro_membros m
                                         WHERE m.quadro_id = q.id AND m.user_id <> t.user_id))))
$$;

-- Ações que marcaram para quem pergunta ver (de outros donos; as passadas a ela já vêm por equipe_tarefas_para_mim).
CREATE OR REPLACE FUNCTION equipe_tarefas_marcadas_para_mim() RETURNS TABLE (tarefa_id UUID, dono_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.user_id
    FROM tarefa_acessos ta JOIN tarefas t ON t.id = ta.tarefa_id
   WHERE ta.user_id = equipe_eu() AND equipe_eu() IS NOT NULL
     AND t.user_id <> equipe_eu()
     AND t.responsavel_user_id IS DISTINCT FROM equipe_eu()
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'equipe_chamado_na_reuniao(uuid)', 'equipe_posso_puxar(uuid)', 'equipe_acesso_tarefa(uuid)',
    'equipe_tarefas_com_outros(uuid[])', 'equipe_tarefas_marcadas_para_mim()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_tenant', f);
  END LOOP;
END $$;

COMMIT;

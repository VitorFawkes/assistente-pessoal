-- Só no banco da equipe (acoes-equipe).
-- Pedido do Vitor (27/09/2026): "Se a pessoa gravar a reunião pelo teams, conseguimos que vá
-- para o mesmo fluxo que se fosse pela aba do ttars?" + "Pode ser a opção 1, mas quem estava
-- nela pode conseguir achar ela e ver as tarefas pra puxar".
--
-- 1. meetings.source ganha 'teams' e meetings.teams_evento guarda o compromisso do Teams (uma
--    reunião do Teams entra uma vez só por conta); audio_path pode ficar vazio.
-- 2. Quem foi chamado para a reunião do Teams (acesso explícito em meeting_acessos) pode puxar
--    uma ação dela para a própria lista. A ação continua de quem criou; o app age no tenant dele, no
--    mesmo desenho de equipe_acesso_tarefa (008).
-- 3. equipe_teams_paradas(): reunião do Teams que ficou analisando (servidor reiniciou no meio):
--    com resumo gravado fica pronta; sem, tenta uma vez de novo; depois vira erro.

BEGIN;

ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_source_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_source_check
  CHECK (source = ANY (ARRAY['macbook', 'iphone', 'ios-app', 'segmented', 'teams']));

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS teams_evento TEXT;
-- Quem da Welcome estava no convite do Teams (e-mail em minúscula). Continua podendo puxar as
-- ações mesmo se quem marcou abrir a reunião para toda a Welcome (o que apaga os escolhidos).
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS teams_convidados TEXT[];
-- Reunião do Teams não tem áudio aqui (o vídeo fica no Teams). No banco da equipe a coluna já
-- aceita vazio (conferido em 27/09); aqui fica escrito, para o repositório bater com o banco.
ALTER TABLE meetings ALTER COLUMN audio_path DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meetings_teams_evento_unico
  ON meetings (user_id, teams_evento) WHERE teams_evento IS NOT NULL;

-- Quem pergunta foi chamado para a reunião: pessoa escolhida em "Quem vê", ou quem estava no
-- convite do Teams enquanto a reunião está aberta para toda a Welcome. "Só eu" tira todo mundo.
CREATE OR REPLACE FUNCTION equipe_chamado_na_reuniao(p_meeting UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT equipe_eu() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM meeting_acessos ma
       WHERE ma.meeting_id = p_meeting AND ma.user_id = equipe_eu()
    )
    OR EXISTS (
      SELECT 1 FROM meetings m JOIN users u ON u.id = equipe_eu()
       WHERE m.id = p_meeting AND m.visibilidade = 'todos'
         AND LOWER(u.email) = ANY (m.teams_convidados)
    )
  )
$$;

-- A ação de uma reunião do Teams para a qual quem pergunta foi chamado (e que ele não criou).
CREATE OR REPLACE FUNCTION equipe_posso_puxar(p_tarefa UUID)
RETURNS TABLE (dono_id UUID, responsavel_id UUID, status TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.user_id, t.responsavel_user_id, t.status
    FROM tarefas t
    JOIN meetings m ON m.id = t.meeting_id AND m.source = 'teams'
   WHERE t.id = p_tarefa
     AND t.user_id <> equipe_eu()
     AND equipe_chamado_na_reuniao(t.meeting_id)
$$;

CREATE OR REPLACE FUNCTION equipe_teams_paradas()
RETURNS TABLE (meeting_id UUID, user_id UUID, tem_resumo BOOLEAN, ja_retomada BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.user_id, m.summary IS NOT NULL, COALESCE(m.status_error = 'retomada', false)
    FROM meetings m
   WHERE m.source = 'teams'
     AND m.status = 'analyzing'
     AND m.created_at < now() - interval '20 minutes'
     AND m.created_at > now() - interval '2 days'
   ORDER BY m.created_at
   LIMIT 3
$$;

REVOKE ALL ON FUNCTION equipe_chamado_na_reuniao(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION equipe_posso_puxar(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION equipe_teams_paradas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION equipe_chamado_na_reuniao(UUID) TO app_tenant;
GRANT EXECUTE ON FUNCTION equipe_posso_puxar(UUID) TO app_tenant;
GRANT EXECUTE ON FUNCTION equipe_teams_paradas() TO app_tenant;

COMMIT;

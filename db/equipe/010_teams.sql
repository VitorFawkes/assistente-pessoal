-- Só no banco da equipe (acoes-equipe).
-- Pedido do Vitor (27/09/2026): "Se a pessoa gravar a reunião pelo teams, conseguimos que vá
-- para o mesmo fluxo que se fosse pela aba do ttars?" + "Pode ser a opção 1, mas quem estava
-- nela pode conseguir achar ela e ver as tarefas pra puxar".
--
-- 1. meetings.source ganha 'teams' e meetings.teams_evento guarda o compromisso do Teams (uma
--    reunião do Teams entra uma vez só por conta); audio_path pode ficar vazio.
-- 2. Quem foi chamado para a reunião (acesso explícito em meeting_acessos) pode puxar uma ação
--    dela para a própria lista. A ação continua de quem criou; o app age no tenant dele, no
--    mesmo desenho de equipe_acesso_tarefa (008).
-- 3. equipe_teams_paradas(): reunião do Teams que ficou analisando (servidor reiniciou no meio)
--    volta para a fila.

BEGIN;

ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_source_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_source_check
  CHECK (source = ANY (ARRAY['macbook', 'iphone', 'ios-app', 'segmented', 'teams']));

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS teams_evento TEXT;
-- Reunião do Teams não tem áudio aqui (o vídeo fica no Teams). No banco da equipe a coluna já
-- aceita vazio (conferido em 27/09); aqui fica escrito, para o repositório bater com o banco.
ALTER TABLE meetings ALTER COLUMN audio_path DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meetings_teams_evento_unico
  ON meetings (user_id, teams_evento) WHERE teams_evento IS NOT NULL;

-- Quem pergunta foi chamado para a reunião (pessoa escolhida ou quem estava nela no Teams).
CREATE OR REPLACE FUNCTION equipe_chamado_na_reuniao(p_meeting UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT equipe_eu() IS NOT NULL AND EXISTS (
    SELECT 1 FROM meeting_acessos ma
     WHERE ma.meeting_id = p_meeting AND ma.user_id = equipe_eu()
  )
$$;

-- A ação de uma reunião para a qual quem pergunta foi chamado (e que ele não criou).
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

CREATE OR REPLACE FUNCTION equipe_teams_paradas() RETURNS TABLE (meeting_id UUID, user_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.user_id
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

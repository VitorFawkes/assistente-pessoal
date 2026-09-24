-- Instância da equipe: reunião fatiada em pedaços mantém quem pode ver.
-- Sem isto, um pedaço de uma reunião "só eu" nascia "toda a Welcome".

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

  -- Só quando ninguém escolheu: usa o padrão da pessoa (ou toda a Welcome)
  IF NEW.visibilidade IS NULL THEN
    NEW.visibilidade := COALESCE(padrao, 'todos');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION copiar_acessos_do_pai()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO meeting_acessos (meeting_id, user_id, time_id, created_by)
  SELECT NEW.id, ma.user_id, ma.time_id, ma.created_by
  FROM meeting_acessos ma
  WHERE ma.meeting_id = NEW.parent_meeting_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS copiar_acessos_do_pai_trigger ON meetings;
CREATE TRIGGER copiar_acessos_do_pai_trigger
AFTER INSERT ON meetings
FOR EACH ROW
WHEN (NEW.parent_meeting_id IS NOT NULL)
EXECUTE FUNCTION copiar_acessos_do_pai();

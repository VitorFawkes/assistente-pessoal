-- Só no banco da equipe (acoes-equipe).
-- Decisão do Vitor (25/09/2026): "Por default as reuniões não devem ir pra todos."
-- Reunião nova nasce "só eu"; a pessoa libera se quiser (na reunião ou no padrão dela).

BEGIN;

ALTER TABLE users ALTER COLUMN visibilidade_padrao SET DEFAULT 'so_eu';

-- Ninguém escolheu "toda a Welcome" de propósito até aqui: o valor veio do padrão antigo.
UPDATE users SET visibilidade_padrao = 'so_eu' WHERE visibilidade_padrao = 'todos';

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

  -- Só quando ninguém escolheu: usa o padrão da pessoa (ou só ela vê)
  IF NEW.visibilidade IS NULL THEN
    NEW.visibilidade := COALESCE(padrao, 'so_eu');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

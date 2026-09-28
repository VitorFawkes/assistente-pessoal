-- Só no banco da equipe (acoes-equipe).
-- Pedido do Vitor (28/09/2026): "poder excluir reuniões pra mim se eu quiser".
-- Reunião do Teams excluída não volta: o TTARS pergunta pelas reuniões que acabaram nas últimas 3 h, e sem esta
-- lista a reunião apagada pareceria nova e entraria de novo. Guarda só quem marcou e o id do compromisso.
-- Sem DROP. Idempotente (pode rodar de novo).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS teams_apagadas (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teams_evento TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, teams_evento)
);

ALTER TABLE teams_apagadas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'teams_apagadas' AND policyname = 'teams_apagadas_tenant') THEN
    CREATE POLICY teams_apagadas_tenant ON teams_apagadas FOR ALL
      USING (user_id::text = current_setting('app.current_user_id', true))
      WITH CHECK (user_id::text = current_setting('app.current_user_id', true));
  END IF;
END $$;
REVOKE ALL ON teams_apagadas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON teams_apagadas TO app_tenant, app_writer;

COMMIT;

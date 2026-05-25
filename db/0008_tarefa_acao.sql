-- ─────────────────────────────────────────────────────────────────────
-- db/0008_tarefa_acao.sql
-- Adiciona coluna `acao` em tarefas com 3 estados:
--   executar = Vitor faz o trabalho diretamente
--   cobrar   = outro executa, mas Vitor acompanha/cobra (follow-up dele)
--   aguardar = outro executa autonomamente, Vitor não precisa cobrar
--
-- Hoje só temos is_mine (generated = owner='vitor'). Isso confunde dois
-- casos distintos: tarefas "Cobrar X de Y" (delegação com follow-up
-- ativo) ficam ocultas em "Aguardando outros" porque owner≠'vitor', mas
-- na prática são trabalho do Vitor — só que tracking, não execução.
--
-- Backfill conservador: is_mine=true → executar, is_mine=false → aguardar.
-- Vitor re-marca pra 'cobrar' o que for follow-up ativo dele.
--
-- Aplicar:
--   psql "$DATABASE_URL" -f db/0008_tarefa_acao.sql
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS acao TEXT;

UPDATE tarefas
SET acao = CASE
  WHEN owner = 'vitor' THEN 'executar'
  ELSE 'aguardar'
END
WHERE acao IS NULL;

ALTER TABLE tarefas ALTER COLUMN acao SET NOT NULL;
ALTER TABLE tarefas ALTER COLUMN acao SET DEFAULT 'executar';

-- CHECK constraint (drop+add pra ser idempotente)
ALTER TABLE tarefas DROP CONSTRAINT IF EXISTS tarefas_acao_valid;
ALTER TABLE tarefas ADD CONSTRAINT tarefas_acao_valid
  CHECK (acao IN ('executar', 'cobrar', 'aguardar'));

CREATE INDEX IF NOT EXISTS tarefas_acao_idx
  ON tarefas (user_id, acao, status);

COMMIT;

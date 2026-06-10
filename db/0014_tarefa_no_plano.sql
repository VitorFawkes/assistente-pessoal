-- ─────────────────────────────────────────────────────────────────────
-- 0013_tarefa_no_plano.sql — opt-in do Plano de ação.
--
-- Por padrão NENHUMA tarefa entra na página /plano automaticamente (tarefas
-- extraídas de reunião já vêm com prazo e estavam "vazando" pra timeline).
-- O usuário escolhe quais ficam no plano (no_plano = true).
--
-- Aditiva, idempotente, não-destrutiva. Aplicar:
--   psql "$DATABASE_URL" -f db/0013_tarefa_no_plano.sql
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS no_plano boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tarefas_no_plano
  ON tarefas (user_id) WHERE no_plano;

-- Backfill one-time: as tarefas que já posicionamos (têm início, viram barras)
-- entram no plano. As demais (só prazo, automático de reunião) ficam de fora.
UPDATE tarefas SET no_plano = true WHERE inicio IS NOT NULL AND no_plano = false;

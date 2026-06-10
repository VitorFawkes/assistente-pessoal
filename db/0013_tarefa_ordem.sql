-- ─────────────────────────────────────────────────────────────────────
-- 0013_tarefa_ordem.sql — ordem MANUAL opcional pras tarefas (/plano "Por tarefa").
--
-- `ordem` permite ao usuário arrastar as linhas e definir "o que vem primeiro".
-- NULL = sem ordem manual → a timeline cai no fallback por data (prazo/início).
-- Quanto menor o número, mais no topo. A UI reatribui valores com folga ao reordenar.
--
-- Aditiva, idempotente, não-destrutiva (nullable; nenhum dado existente muda).
-- Aplicar: psql "$DATABASE_URL" -f db/0013_tarefa_ordem.sql
-- Rollback: ALTER TABLE tarefas DROP COLUMN IF EXISTS ordem;
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS ordem INTEGER NULL;

CREATE INDEX IF NOT EXISTS idx_tarefas_ordem
  ON tarefas (user_id, ordem)
  WHERE ordem IS NOT NULL;

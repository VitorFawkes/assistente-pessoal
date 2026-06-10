-- ─────────────────────────────────────────────────────────────────────
-- 0012_tarefa_inicio.sql — data de INÍCIO opcional pra tarefas (cronograma /plano).
--
-- `prazo` continua sendo o FIM/deadline. `inicio` é o COMEÇO (opcional). Quando os
-- dois existem, a página /plano desenha uma BARRA de duração (Gantt); quando só há
-- prazo, desenha um MARCO (losango) na data — degrada graciosamente sem preencher nada.
--
-- Aditiva, idempotente, não-destrutiva (nullable; nenhum dado existente muda).
-- Aplicar: psql "$DATABASE_URL" -f db/0012_tarefa_inicio.sql
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS inicio TIMESTAMPTZ NULL;

-- índice parcial barato — a timeline só lê o que tem data
CREATE INDEX IF NOT EXISTS idx_tarefas_inicio
  ON tarefas (user_id, inicio)
  WHERE inicio IS NOT NULL;

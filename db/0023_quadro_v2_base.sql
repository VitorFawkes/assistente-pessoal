-- ─────────────────────────────────────────────────────────────────────
-- 0023_quadro_v2_base.sql — base da nova experiência de Quadros
--
-- 1. status ganha 'aguardando_aprovacao' (4 situações na UI:
--    A fazer=aberta · Fazendo=em_andamento · Aguardando aprovação · Feito=concluida)
-- 2. tarefas.depende_de TEXT (texto livre, sem FK — espelha o rascunho)
-- 3. backfill: toda tarefa com pessoas passa a ter exatamente 1 principal (o dono)
--
-- Aditiva, idempotente, não-destrutiva. Nenhuma tarefa muda de status.
--   psql "$DATABASE_URL" -f db/0023_quadro_v2_base.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

-- 1. status: acrescenta 'aguardando_aprovacao' sem travar a tabela
ALTER TABLE tarefas DROP CONSTRAINT IF EXISTS tarefas_status_check;
ALTER TABLE tarefas ADD CONSTRAINT tarefas_status_check
  CHECK (status IN ('aberta','em_andamento','aguardando_aprovacao','concluida','cancelada')) NOT VALID;
ALTER TABLE tarefas VALIDATE CONSTRAINT tarefas_status_check;

-- 2. "depende de" — texto livre mostrado na tarefa
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS depende_de TEXT;

-- 3. dono = tarefa_pessoas.principal. Tarefa com pessoas mas sem principal
--    ganha a primeira (menor id) como dono. Não inventa dono onde não há pessoa.
WITH sem_principal AS (
  SELECT tarefa_id
  FROM tarefa_pessoas
  GROUP BY tarefa_id
  HAVING bool_and(NOT principal)
), eleitos AS (
  SELECT DISTINCT ON (tp.tarefa_id) tp.tarefa_id, tp.pessoa_id
  FROM tarefa_pessoas tp
  JOIN sem_principal s ON s.tarefa_id = tp.tarefa_id
  ORDER BY tp.tarefa_id, tp.pessoa_id
)
UPDATE tarefa_pessoas tp
SET principal = TRUE
FROM eleitos e
WHERE tp.tarefa_id = e.tarefa_id AND tp.pessoa_id = e.pessoa_id;

-- garante no máximo 1 principal por tarefa (se houver mais de um, mantém o menor)
WITH extras AS (
  SELECT tarefa_id, pessoa_id,
         row_number() OVER (PARTITION BY tarefa_id ORDER BY pessoa_id) AS n
  FROM tarefa_pessoas
  WHERE principal
)
UPDATE tarefa_pessoas tp
SET principal = FALSE
FROM extras e
WHERE tp.tarefa_id = e.tarefa_id AND tp.pessoa_id = e.pessoa_id AND e.n > 1;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- 0025_tarefa_situacao_desde.sql — desde quando a tarefa está nesta coluna
--
-- No quadro em Colunas, o Vitor quer saber há quanto tempo cada tarefa está
-- parada onde está ("quando entrou ali"). Isso não existia: só a coluna Feito
-- tinha data, via `concluida_em`, e mesmo assim nem em todas.
--
-- Guarda o instante da ÚLTIMA troca de situação. Quem escreve são as rotas de
-- PATCH (dono, convidado, agente e lote), sempre que `status` muda.
--
-- Backfill deliberadamente PARCIAL: só as concluídas que já têm
-- `concluida_em`. Pro resto fica NULL e a tela mostra em branco — data
-- inventada seria pior que ausência de data.
--
-- Aditiva, idempotente, não-destrutiva. Aplicar:
--   psql "$DATABASE_URL" -f db/0025_tarefa_situacao_desde.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS situacao_desde TIMESTAMPTZ NULL;

COMMENT ON COLUMN tarefas.situacao_desde IS
  'Quando a tarefa entrou na situação atual. NULL = nunca mudou de situação desde 26/08/2026 (não dá pra saber).';

-- Só as concluídas com data confiável. Nada de chute nas outras.
UPDATE tarefas
   SET situacao_desde = concluida_em
 WHERE situacao_desde IS NULL
   AND status = 'concluida'
   AND concluida_em IS NOT NULL;

-- Ordenar a coluna por "quem entrou por último" é a leitura mais comum.
CREATE INDEX IF NOT EXISTS idx_tarefas_situacao_desde
  ON tarefas (user_id, status, situacao_desde DESC NULLS LAST);

COMMIT;

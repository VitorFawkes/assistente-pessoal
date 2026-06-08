-- 0011_captura.sql — captura sem fricção
-- Constrói sobre 0010 (frentes/tarefa_pessoas/pessoas_raw/area_raw) já aplicado.

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS precisa_revisao boolean NOT NULL DEFAULT false;

-- filtro futuro "só revisar" (parcial, barato)
CREATE INDEX IF NOT EXISTS idx_tarefas_revisao ON tarefas (user_id) WHERE precisa_revisao;

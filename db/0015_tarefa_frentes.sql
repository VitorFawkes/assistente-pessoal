-- ─────────────────────────────────────────────────────────────────────
-- 0015_tarefa_frentes.sql — múltiplas áreas (frentes) por tarefa.
--
-- Join N:N espelhando tarefa_pessoas. `tarefas.frente_id` continua existindo
-- como a frente PRINCIPAL (compatibilidade com triggers/queries antigas);
-- o app mantém as duas em sincronia ao editar.
--
-- Aditiva, idempotente, não-destrutiva. Aplicar:
--   psql "$DATABASE_URL" -f db/0015_tarefa_frentes.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS tarefa_frentes (
  tarefa_id UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  frente_id UUID NOT NULL REFERENCES frentes(id) ON DELETE CASCADE,
  principal BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tarefa_id, frente_id)
);
CREATE INDEX IF NOT EXISTS idx_tarefa_frentes_frente ON tarefa_frentes(frente_id);

-- RLS + grants (espelha tarefa_pessoas)
ALTER TABLE tarefa_frentes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarefa_frentes_tenant ON tarefa_frentes;
CREATE POLICY tarefa_frentes_tenant ON tarefa_frentes FOR ALL
  USING (EXISTS (SELECT 1 FROM tarefas WHERE tarefas.id = tarefa_frentes.tarefa_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON tarefa_frentes TO app_tenant, app_writer;

-- Backfill one-time: frente_id atual vira a frente principal
INSERT INTO tarefa_frentes (tarefa_id, frente_id, principal)
SELECT id, frente_id, true FROM tarefas WHERE frente_id IS NOT NULL
ON CONFLICT (tarefa_id, frente_id) DO NOTHING;

COMMIT;

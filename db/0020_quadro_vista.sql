-- ─────────────────────────────────────────────────────────────────────
-- 0020_quadro_vista.sql — visão padrão do quadro (lista | timeline).
--
-- Um "plano" passa a ser um quadro visto como linha do tempo. Esta coluna
-- guarda em qual visão o quadro abre; marcar 'timeline' É o "transformar em
-- plano". A ordenação da timeline reusa quadro_tarefas.ordem (já existe).
--
-- O /plano pessoal (tarefas.no_plano) NÃO é tocado — segue como está.
--
-- Aditiva, idempotente, não-destrutiva. Aplicar:
--   psql "$DATABASE_URL" -f db/0020_quadro_vista.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE quadros
  ADD COLUMN IF NOT EXISTS vista_padrao TEXT NOT NULL DEFAULT 'lista';

-- CHECK idempotente (não existe ADD CONSTRAINT IF NOT EXISTS até PG15+ em todos os casos)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quadros_vista_padrao_check'
  ) THEN
    ALTER TABLE quadros
      ADD CONSTRAINT quadros_vista_padrao_check
      CHECK (vista_padrao IN ('lista','timeline'));
  END IF;
END $$;

COMMIT;

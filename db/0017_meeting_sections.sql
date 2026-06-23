-- ─────────────────────────────────────────────────────────────────────
-- Seções de assunto dentro de UMA reunião (não-destrutivo).
-- Array ordenado [{ "start_seconds": number, "title": string }].
-- A primeira seção é implícita (começa em 0); só marca-se onde NASCE
-- uma seção nova. Idempotente. Aplicar manual via dbgate/pgweb/psql.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN meetings.sections IS
  'Marcadores de seção de assunto: [{start_seconds, title}] ordenado. [] = sem seções. Não-destrutivo (só organização visual + export por seção).';

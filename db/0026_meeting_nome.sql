-- ─────────────────────────────────────────────────────────────────────
-- 0026_meeting_nome.sql — reunião ganha nome próprio, escrito por gente
--
-- Hoje a reunião não tem nome: as telas esculpem um rótulo do parágrafo de
-- resumo que a IA escreveu (`lib/meeting-label.ts`). Em 100 dos 174 resumos o
-- texto começa com "Reunião entre Vitor e…", e o que sobra depois de cortar a
-- abertura ainda começa pelas PESSOAS, não pelo assunto. Na hora de escolher
-- tarefas, quatro reuniões seguidas apareciam com o mesmo texto cortado.
--
-- `nome` NULL = ninguém batizou ainda, e a tela segue esculpindo do resumo.
--
-- Aditiva, idempotente, não-destrutiva. Aplicar:
--   psql "$DATABASE_URL" -f db/0026_meeting_nome.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS nome TEXT NULL;

COMMENT ON COLUMN meetings.nome IS
  'Nome dado à reunião por uma pessoa. NULL = usar o rótulo esculpido do summary.';

COMMIT;

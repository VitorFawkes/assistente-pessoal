-- ─────────────────────────────────────────────────────────────────────
-- 0022_segments_removidos.sql — lixeira dos trechos apagados da transcrição.
--
-- O usuário passa a apagar trechos ruins da transcrição (papo de aeroporto,
-- conversa paralela) pra que resumo e tarefas parem de considerá-los. O texto
-- sai de `segments`/`transcription` de verdade — assim tudo que lê a reunião
-- (resumo, tarefas, download, impressão) enxerga a mesma coisa, sem cada
-- consumidor precisar filtrar. O que saiu fica guardado aqui, no formato
-- idêntico ao de `segments`, pra permitir "restaurar" em um clique.
--
-- Os `start`/`end` dos que ficam NÃO são reescritos: o áudio continua inteiro,
-- então seções e o seek do player seguem batendo.
--
-- Aditiva, idempotente, não-destrutiva. Aplicar:
--   psql "$DATABASE_URL" -f db/0022_segments_removidos.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS segments_removidos JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;

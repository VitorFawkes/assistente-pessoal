-- Só no banco da equipe (acoes-equipe).
-- O Supabase liga o RLS sozinho em tabela nova (29/09/2026: notion_projetos e notion_comentarios
-- nasceram com RLS e sem regra, e o app não conseguia gravar). São tabelas de sistema, como as da
-- 009 (sem RLS e fora do alcance de anon/authenticated): o app lê e escreve direto.

BEGIN;

ALTER TABLE notion_projetos DISABLE ROW LEVEL SECURITY;
ALTER TABLE notion_comentarios DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON notion_projetos, notion_comentarios FROM PUBLIC, anon, authenticated;

COMMIT;

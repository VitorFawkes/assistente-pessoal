-- Só no banco da equipe (acoes-equipe).
-- "Salvar como lista" em /acoes/pedidos falhava com "Lugar da lista inválido.": o lugar 'pedidos' não estava no CHECK de
-- acoes_listas.onde (011) nem no ONDE_RE de lib/hub.ts. Passa a aceitar 'pedidos'.
-- Pode rodar de novo; não apaga nenhuma lista (só troca a regra por uma que aceita mais lugares).
BEGIN;
ALTER TABLE acoes_listas DROP CONSTRAINT IF EXISTS acoes_listas_onde_check;
ALTER TABLE acoes_listas ADD CONSTRAINT acoes_listas_onde_check
  CHECK (onde ~ '^(minhas|pedidos|(time|projeto|objetivo):[A-Za-z0-9_-]{1,80})$');
COMMIT;

-- Listas salvas (29/09/2026, "uma visualização igual à do Notion"): a visão Tabela e as 11 ordens da tela.
-- A 011 só aceitava lista/quadro e 5 ordens; a tela já oferecia 11 ordens (salvar lista ordenada por
-- Prioridade, Quem pediu, Objetivo, Time, Reunião ou Nome era recusado pelo banco). Só troca as duas
-- regras de conferência; nenhuma linha muda (conferido em 29/09: 0 listas salvas).
BEGIN;
ALTER TABLE acoes_listas DROP CONSTRAINT IF EXISTS acoes_listas_vista_check;
ALTER TABLE acoes_listas ADD CONSTRAINT acoes_listas_vista_check CHECK (vista IS NULL OR vista IN ('lista', 'quadro', 'tabela'));
ALTER TABLE acoes_listas DROP CONSTRAINT IF EXISTS acoes_listas_ordem_check;
ALTER TABLE acoes_listas ADD CONSTRAINT acoes_listas_ordem_check
  CHECK (ordem IS NULL OR ordem IN ('prazo', 'criada', 'pessoa', 'pediu', 'prioridade', 'projeto', 'objetivo', 'time', 'reuniao', 'situacao', 'titulo'));
COMMIT;

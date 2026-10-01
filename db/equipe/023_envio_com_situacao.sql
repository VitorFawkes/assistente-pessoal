-- Só no banco da equipe (acoes-equipe).
-- Nova tarefa pelo Hub do Marketing (TTARS, 01/10/2026): a página nasce no Notion como foi escolhida lá,
-- igual ao New do Notion. "+ New task" no pé de uma coluna do quadro By status nasce naquela situação
-- (To Day, Daily, Up next…, e não no nome padrão da situação do Ações); o que não foi escolhido (prioridade,
-- BU) fica vazio; quem faz vai em Person e Assign. A fila de envio guarda essas escolhas até a página nascer:
--   do_hub = {"situacao": "To Day", "prioridade": true|false, "bu": "Weddings"|null}
-- Pode rodar de novo; só acrescenta a coluna.
BEGIN;
ALTER TABLE notion_envios ADD COLUMN IF NOT EXISTS do_hub JSONB;
COMMIT;

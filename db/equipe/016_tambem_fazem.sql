-- Subresponsáveis (pedido do Vitor, 29/09/2026: "tarefas podem ter subresponsáveis"): quem TAMBÉM faz a ação.
-- Mora em tarefa_acessos (as pessoas marcadas para ver) com a marca faz: quem também faz vê e mexe na ação como
-- quem foi marcado (papel 'pessoa' de equipe_acesso_tarefa), a ação aparece na lista dela
-- (equipe_tarefas_marcadas_para_mim) e a tela mostra que ela faz. Nenhuma função muda.
-- Só acrescenta uma coluna com padrão: nada existente muda de valor.
BEGIN;
ALTER TABLE tarefa_acessos ADD COLUMN IF NOT EXISTS faz BOOLEAN NOT NULL DEFAULT false;
COMMIT;

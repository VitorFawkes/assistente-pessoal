-- Só no banco da equipe (acoes-equipe).
-- Pedidos ao Marketing sem as limitações (Vitor 01/10/2026: "Pq só uma pessoa pode receber o formulário?"):
--   - tarefa_pedidos.unico: o pedido foi feito num formulário de UM pedido por casamento (destino.um_por_casamento).
--     O índice de repetido passa a valer só para esses; nos outros, o mesmo casamento pode ter vários pedidos.
--     Todo pedido que já existe era de um por casamento (padrão true).
--   - tarefa_pedidos.quem_emails: quem recebeu o pedido, na ordem (a 1ª faz, as outras também fazem; a página do
--     Notion nasce com todas as que estão lá). Pedido antigo fica NULL (só a 1ª, como era).
--   - o gatilho que solta/segura o casamento ao cancelar/reabrir olha só os pedidos de um por casamento;
--   - a cobertura ganha quem_emails (a mesma pessoa de quem_email) e um_por_casamento = true.
-- Pode rodar de novo sem estrago: nada é apagado (o índice só é recriado se ainda não olhar `unico`).
-- Rodou a 020 de novo depois desta? Rode esta de novo (a 020 volta o gatilho à versão de antes).

BEGIN;

ALTER TABLE tarefa_pedidos ADD COLUMN IF NOT EXISTS unico BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tarefa_pedidos ADD COLUMN IF NOT EXISTS quem_emails TEXT[];

-- Repetido: um pedido vivo por formulário e casamento, só nos formulários de um por casamento.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'tarefa_pedidos_um_vivo_por_card' AND indexdef LIKE '%AND unico%') THEN
    DROP INDEX IF EXISTS tarefa_pedidos_um_vivo_por_card;
    CREATE UNIQUE INDEX tarefa_pedidos_um_vivo_por_card
      ON tarefa_pedidos(formulario_id, card_id) WHERE card_id IS NOT NULL AND NOT cancelado AND unico;
  END IF;
END $$;

-- A ação cancelada solta o casamento para um pedido novo; reaberta volta a segurar (se ninguém pediu de novo
-- nesse meio tempo: aí ela fica solta, e o pedido novo é o que vale). Pedido de formulário que aceita vários
-- por casamento não segura nada: reaberto, volta a valer sempre.
CREATE OR REPLACE FUNCTION pedido_acompanha_situacao() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'cancelada' THEN
      UPDATE tarefa_pedidos SET cancelado = true WHERE tarefa_id = NEW.id AND NOT cancelado;
    ELSE
      UPDATE tarefa_pedidos tp SET cancelado = false
       WHERE tp.tarefa_id = NEW.id AND tp.cancelado
         AND (NOT tp.unico
              OR NOT EXISTS (SELECT 1 FROM tarefa_pedidos o
                              WHERE o.formulario_id = tp.formulario_id AND o.card_id = tp.card_id
                                AND o.tarefa_id <> tp.tarefa_id AND NOT o.cancelado AND o.unico));
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION pedido_acompanha_situacao() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pedido_acompanha_situacao() TO app_tenant, app_writer;

-- A cobertura: quem recebe vira lista (a mesma pessoa de hoje) e continua um pedido por casamento. Só
-- acrescenta o que falta (quem já mudou pela tela não é desfeito).
UPDATE pedido_formularios
   SET destino = destino
       || CASE WHEN destino ? 'quem_emails' THEN '{}'::jsonb
               ELSE jsonb_build_object('quem_emails',
                      CASE WHEN COALESCE(destino->>'quem_email', '') <> '' THEN jsonb_build_array(LOWER(destino->>'quem_email'))
                           ELSE '[]'::jsonb END) END
       || CASE WHEN destino ? 'um_por_casamento' THEN '{}'::jsonb ELSE '{"um_por_casamento": true}'::jsonb END
 WHERE slug = 'cobertura-casamento'
   AND NOT (destino ? 'quem_emails' AND destino ? 'um_por_casamento');

COMMIT;

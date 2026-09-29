-- Só no banco da equipe (acoes-equipe).
-- Pedido do Vitor (28/09/2026): editar a ação "igual fizemos em ações", com comentário de verdade.
-- Tabela própria (não mexe em tarefa_eventos: projetos, quadros, coach e repetidas leem aquela lista como
-- atividade). Mora no tenant do dono da tarefa e herda o RLS pela tarefa, como tarefa_eventos; quem entra por
-- time, projeto ou marcação passa pelo app, que confere o acesso (acessoTarefa) e grava no tenant do dono.
-- Sem DROP. Idempotente (pode rodar de novo).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS tarefa_comentarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id     UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  autor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  texto         TEXT NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 4000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tarefa_comentarios_tarefa ON tarefa_comentarios(tarefa_id, created_at);

ALTER TABLE tarefa_comentarios ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tarefa_comentarios' AND policyname = 'tarefa_comentarios_tenant') THEN
    CREATE POLICY tarefa_comentarios_tenant ON tarefa_comentarios FOR ALL
      USING (EXISTS (SELECT 1 FROM tarefas WHERE tarefas.id = tarefa_comentarios.tarefa_id))
      WITH CHECK (EXISTS (SELECT 1 FROM tarefas WHERE tarefas.id = tarefa_comentarios.tarefa_id));
  END IF;
END $$;
REVOKE ALL ON tarefa_comentarios FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON tarefa_comentarios TO app_tenant, app_writer;

COMMIT;

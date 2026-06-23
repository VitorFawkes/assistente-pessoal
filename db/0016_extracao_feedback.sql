-- 0016: loop de feedback da extração de tarefas
-- Correções manuais (de→para) e rejeições ("não é tarefa") guardadas de forma
-- PERSISTENTE — não somem quando a tarefa é editada/deletada (ao contrário de
-- tarefa_eventos, que tem CASCADE). Alimentam a extração futura (few-shot/guidance).

CREATE TABLE IF NOT EXISTS extracao_feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  meeting_id UUID,                 -- sem FK CASCADE de propósito: o feedback sobrevive
  tipo       TEXT NOT NULL CHECK (tipo IN ('correcao','rejeicao')),
  payload    JSONB NOT NULL,       -- correcao: {changed:{campo:{de,para}}} | rejeicao: {titulo,owner,acao,descricao,...}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extracao_feedback_user ON extracao_feedback(user_id, created_at DESC);

ALTER TABLE extracao_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS extracao_feedback_tenant ON extracao_feedback;
CREATE POLICY extracao_feedback_tenant ON extracao_feedback
  FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON extracao_feedback TO app_tenant, app_writer;

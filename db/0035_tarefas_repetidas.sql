-- ─────────────────────────────────────────────────────────────────────
-- 0035_tarefas_repetidas.sql — tarefa falada de novo entra no card que já existe
--
-- Antes, cada reunião criava as suas tarefas sem olhar as reuniões anteriores:
-- o mesmo assunto virava um card novo toda vez que voltava a ser falado (a
-- página de planejamento do TARS virou 8 cards entre 25/06 e 06/08/2026).
--
-- Agora, antes de criar, a tarefa nova é comparada com as que já existem
-- (lib/tarefas-repetidas.ts, rota /api/admin/tarefas/incorporar):
--   * tarefa_mencoes    — "falada de novo em DD/MM": a vez em que uma reunião
--                         voltou a falar de uma tarefa que já existia.
--   * tarefas.parece_com_id — a dúvida: nasceu o card, mas parece repetido de
--                         outro; a tela mostra os botões "é a mesma" / "são
--                         diferentes".
--   * tarefa_embeddings — cache do vetor de sentido de cada tarefa (a
--                         comparação acha as 10 mais parecidas por ele). Fica
--                         fora de `tarefas` porque TAREFA_SELECT faz `t.*` e
--                         o vetor iria junto em toda lista da tela.
--   * users.dedup_tarefas_desde — liga a comparação com reuniões anteriores
--                         por pessoa (NULL = desligada). A troca de tarefa da
--                         gravação fatiada pelas partes vale sempre.
--   * extracao_feedback aceita 'repetida' e 'diferente' — os cliques viram
--                         exemplo para as próximas comparações.
--
-- Aditiva, idempotente, não-destrutiva. Aplicar:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/0035_tarefas_repetidas.sql
-- (na prática, via docker exec no container n8n_assistente-pessoal-db)
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS tarefa_mencoes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tarefa_id         UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  -- reunião que voltou a falar da tarefa (apagou a reunião → a menção some junto)
  meeting_id        UUID REFERENCES meetings(id) ON DELETE CASCADE,
  -- como a tarefa foi dita nesta reunião (pra "virar tarefa separada" sem perder nada)
  titulo_falado     TEXT NOT NULL,
  descricao_falada  TEXT,
  evidencia         TEXT,
  owner_falado      TEXT,
  acao_falada       TEXT,
  prazo_falado      TIMESTAMPTZ,
  prazo_text_falado TEXT,
  prioridade_falada TEXT,
  pessoas_falado    JSONB,
  area_falada       TEXT,
  -- prazo que o card tinha antes desta reunião mudar (NULL = não mudou)
  prazo_anterior    TIMESTAMPTZ,
  -- de onde veio: 'reuniao' (comparação automática), 'juntada' (clique "é a
  -- mesma"), 'faxina' (limpeza das repetidas antigas)
  origem            TEXT NOT NULL DEFAULT 'reuniao'
                    CHECK (origem IN ('reuniao', 'juntada', 'faxina')),
  -- a tarefa cancelada que virou esta menção (juntada/faxina), pra desfazer
  tarefa_origem_id  UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tarefa_mencoes_tarefa
  ON tarefa_mencoes (tarefa_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tarefa_mencoes_meeting
  ON tarefa_mencoes (meeting_id) WHERE meeting_id IS NOT NULL;
-- reenvio da mesma reunião não duplica a menção
CREATE UNIQUE INDEX IF NOT EXISTS uq_tarefa_mencoes_reuniao
  ON tarefa_mencoes (tarefa_id, meeting_id, titulo_falado)
  WHERE meeting_id IS NOT NULL;

ALTER TABLE tarefa_mencoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarefa_mencoes_tenant ON tarefa_mencoes;
CREATE POLICY tarefa_mencoes_tenant ON tarefa_mencoes FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true))
  WITH CHECK (user_id::text = current_setting('app.current_user_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tarefa_mencoes TO app_tenant, app_writer;

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS parece_com_id UUID NULL REFERENCES tarefas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tarefas_parece_com
  ON tarefas (user_id) WHERE parece_com_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tarefa_embeddings (
  tarefa_id   UUID PRIMARY KEY REFERENCES tarefas(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modelo      TEXT NOT NULL,
  -- hash do texto que gerou o vetor: título ou descrição mudou → recalcula
  texto_hash  TEXT NOT NULL,
  embedding   REAL[] NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tarefa_embeddings_user ON tarefa_embeddings (user_id);

ALTER TABLE tarefa_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarefa_embeddings_tenant ON tarefa_embeddings;
CREATE POLICY tarefa_embeddings_tenant ON tarefa_embeddings FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true))
  WITH CHECK (user_id::text = current_setting('app.current_user_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tarefa_embeddings TO app_tenant, app_writer;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dedup_tarefas_desde TIMESTAMPTZ NULL;
COMMENT ON COLUMN users.dedup_tarefas_desde IS
  'Desde quando a tarefa nova é comparada com as de reuniões anteriores. NULL = desligado.';

ALTER TABLE extracao_feedback DROP CONSTRAINT IF EXISTS extracao_feedback_tipo_check;
ALTER TABLE extracao_feedback ADD CONSTRAINT extracao_feedback_tipo_check
  CHECK (tipo IN ('correcao', 'rejeicao', 'repetida', 'diferente'));

COMMIT;

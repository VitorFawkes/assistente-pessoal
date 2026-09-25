-- Só no banco da equipe (acoes-equipe).
-- Pedido do Vitor (25/09/2026): "Quero integrar isso [as tarefas do marketing no Notion] ao
-- ações... podemos pedir algo pra Paula Klotz, que fica no Tarefa em Ações e vai pro Notion
-- e ela coloca no Notion e aparece no Ações (Sem duplicar é claro)".
--
-- Modelo:
--   - notion_conexoes: a base "Tasks" do Notion do marketing ligada (segredo da conexão,
--     projeto "Marketing" do Ações onde as tarefas aparecem, dono das tarefas que nascem lá);
--   - notion_paginas: cada página do Notion presa a UMA ação (sem duplicar), com os valores
--     da última sincronização (pra saber de que lado mudou);
--   - notion_pessoas: quem aparece nas tarefas do Notion e quem é no Ações;
--   - notion_envios: pedido explícito de mandar uma ação pro Notion (alguém passou pra
--     alguém do marketing ou apertou "Mandar pro Notion").
-- São tabelas de sistema (como sessions): o app lê e escreve direto; nenhuma política de
-- tarefas muda. A ação continua de quem a criou e segue o RLS de sempre.

BEGIN;

CREATE TABLE IF NOT EXISTS notion_conexoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           TEXT NOT NULL,
  database_id     TEXT NOT NULL,
  data_source_id  TEXT NOT NULL,
  bot_id          TEXT,
  nome_base       TEXT,
  quadro_id       UUID REFERENCES quadros(id) ON DELETE SET NULL,
  dono_user_id    UUID NOT NULL REFERENCES users(id),
  ligado_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  ligado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cursor_editado  TIMESTAMPTZ,
  ultima_rodada   TIMESTAMPTZ,
  ultimo_erro     TEXT,
  ativo           BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS notion_conexoes_uma_por_base ON notion_conexoes(database_id) WHERE ativo;

CREATE TABLE IF NOT EXISTS notion_paginas (
  page_id          TEXT PRIMARY KEY,
  conexao_id       UUID NOT NULL REFERENCES notion_conexoes(id) ON DELETE CASCADE,
  tarefa_id        UUID NOT NULL UNIQUE,
  tarefa_dono_id   UUID NOT NULL REFERENCES users(id),
  url              TEXT,
  status_notion    TEXT,
  bu               TEXT,
  ultimos          JSONB NOT NULL DEFAULT '{}'::jsonb,
  editado_notion   TIMESTAMPTZ,
  editado_por      TEXT,
  sincronizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notion_paginas_conexao ON notion_paginas(conexao_id);

CREATE TABLE IF NOT EXISTS notion_pessoas (
  conexao_id      UUID NOT NULL REFERENCES notion_conexoes(id) ON DELETE CASCADE,
  notion_user_id  TEXT NOT NULL,
  nome            TEXT NOT NULL,
  email           TEXT,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conexao_id, notion_user_id)
);

CREATE TABLE IF NOT EXISTS notion_envios (
  tarefa_id       UUID PRIMARY KEY,
  tarefa_dono_id  UUID NOT NULL REFERENCES users(id),
  conexao_id      UUID NOT NULL REFERENCES notion_conexoes(id) ON DELETE CASCADE,
  notion_user_id  TEXT,
  bu              TEXT,
  pedido_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  pedido_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  tentativas      INT NOT NULL DEFAULT 0,
  erro            TEXT
);

-- O Supabase dá acesso automático a anon/authenticated em tabela nova: aqui ninguém de fora lê
-- (a conexão guarda o segredo do Notion).
REVOKE ALL ON notion_conexoes, notion_paginas, notion_pessoas, notion_envios FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notion_conexoes, notion_paginas, notion_pessoas, notion_envios TO app_tenant, app_writer;

COMMIT;

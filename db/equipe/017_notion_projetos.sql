-- Só no banco da equipe (acoes-equipe).
-- Pedido do Vitor (29/09/2026): o Notion do marketing tem que "linkar 100%" com o Ações.
-- Cada projeto da base Projects do Notion vira um projeto no Ações (agrupado como Marketing,
-- sem criar time no TTARS); comentários, arquivos, a coluna Text e quem criou passam também.
--
-- Modelo:
--   - notion_conexoes.projetos_data_source_id: a base Projects (achada pela coluna Project);
--   - notion_projetos: cada projeto do Notion preso a UM projeto do Ações (sem duplicar);
--   - notion_paginas: quem criou a página, onde mora a descrição (Description ou Text) e os
--     arquivos da última sincronização (pra saber o que entrou ou saiu de cada lado);
--   - notion_comentarios: cada comentário do Notion preso a UM comentário do Ações.
-- Tabelas de sistema, como as da 009: o app lê e escreve direto; nenhuma política muda.

BEGIN;

ALTER TABLE notion_conexoes ADD COLUMN IF NOT EXISTS projetos_data_source_id TEXT;
ALTER TABLE notion_conexoes ADD COLUMN IF NOT EXISTS comentarios_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS notion_projetos (
  page_id          TEXT PRIMARY KEY,
  conexao_id       UUID NOT NULL REFERENCES notion_conexoes(id) ON DELETE CASCADE,
  quadro_id        UUID UNIQUE REFERENCES quadros(id) ON DELETE SET NULL,
  nome             TEXT NOT NULL,
  etapa            TEXT,
  inicio           DATE,
  fim              DATE,
  lider            TEXT,
  url              TEXT,
  no_lixo          BOOLEAN NOT NULL DEFAULT false,
  nome_sincronizado TEXT,
  editado_notion   TIMESTAMPTZ,
  sincronizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notion_projetos_conexao ON notion_projetos(conexao_id);

ALTER TABLE notion_paginas ADD COLUMN IF NOT EXISTS criado_por TEXT;
ALTER TABLE notion_paginas ADD COLUMN IF NOT EXISTS campo_descricao TEXT;
ALTER TABLE notion_paginas ADD COLUMN IF NOT EXISTS arquivos JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS notion_comentarios (
  comment_id     TEXT PRIMARY KEY,
  conexao_id     UUID NOT NULL REFERENCES notion_conexoes(id) ON DELETE CASCADE,
  page_id        TEXT NOT NULL,
  comentario_id  UUID UNIQUE,
  origem         TEXT NOT NULL CHECK (origem IN ('notion', 'acoes')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notion_comentarios_pagina ON notion_comentarios(page_id);

REVOKE ALL ON notion_projetos, notion_comentarios FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notion_projetos, notion_comentarios TO app_tenant, app_writer;

COMMIT;

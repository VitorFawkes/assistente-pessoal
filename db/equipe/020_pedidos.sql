-- Só no banco da equipe (acoes-equipe).
-- Pedidos ao Marketing (aprovado pelo Vitor em 30/09/2026, "A e C"): quem é da Welcome pede ao
-- marketing pelo TTARS num formulário; o pedido vira uma ação de quem pediu (quem faz = a pessoa
-- do marketing do formulário) e uma página no Notion do marketing.
--
-- Modelo:
--   - pedido_formularios: cada formulário (perguntas, quem pode pedir, para onde vai), com a versão
--     publicada e o rascunho de quem monta;
--   - tarefa_pedidos: a ação que nasceu de um pedido, com as perguntas daquela versão e as respostas
--     (pedido antigo guarda as perguntas dele mesmo depois de o formulário mudar);
--   - pedido_montadores: quem monta os formulários (além do administrador);
--   - pedido_leituras: arquivo de perguntas lido para montar um formulário (só o texto; o arquivo
--     não é guardado).
-- Tabelas de sistema, como as da 009/017 (sem RLS, fora do alcance de anon/authenticated; o
-- Supabase liga o RLS sozinho em tabela nova — ver 018): o app lê e escreve direto. A ação continua
-- de quem pediu e segue o RLS de sempre.
-- Pode rodar de novo sem estrago (IF NOT EXISTS / ON CONFLICT DO NOTHING); nada é apagado.

BEGIN;

CREATE TABLE IF NOT EXISTS pedido_formularios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  nome           TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  explica        TEXT NOT NULL DEFAULT '' CHECK (length(explica) <= 1000),
  icone          TEXT NOT NULL DEFAULT '📝' CHECK (length(icone) <= 16),
  estado         TEXT NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'no_ar', 'desligado')),
  versao         INT NOT NULL DEFAULT 0 CHECK (versao >= 0),
  perguntas      JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(perguntas) = 'array'),
  publico        JSONB NOT NULL DEFAULT '{"tipo":"empresas","empresas":[],"times":[]}'::jsonb,
  destino        JSONB NOT NULL DEFAULT '{}'::jsonb,
  rascunho       JSONB,
  criado_por     UUID REFERENCES users(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tarefa_pedidos (
  tarefa_id              UUID PRIMARY KEY REFERENCES tarefas(id) ON DELETE CASCADE,
  formulario_id          UUID NOT NULL REFERENCES pedido_formularios(id) ON DELETE RESTRICT,
  versao                 INT NOT NULL,
  perguntas_snapshot     JSONB NOT NULL,
  respostas              JSONB NOT NULL,
  card_id                UUID,
  card_titulo            TEXT,
  pedido_por             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Para onde foi (o projeto do Notion e a área do formulário no momento do pedido).
  projeto_notion_page_id TEXT,
  bu                     TEXT,
  -- Espelha tarefas.status = 'cancelada' (gatilho abaixo): é o que o índice de repetido olha.
  cancelado              BOOLEAN NOT NULL DEFAULT false,
  criado_em              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tarefa_pedidos_formulario ON tarefa_pedidos(formulario_id);
CREATE INDEX IF NOT EXISTS idx_tarefa_pedidos_card ON tarefa_pedidos(card_id) WHERE card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarefa_pedidos_pedido_por ON tarefa_pedidos(pedido_por);
-- Repetido: um pedido vivo (não cancelado nem apagado) por formulário e casamento.
CREATE UNIQUE INDEX IF NOT EXISTS tarefa_pedidos_um_vivo_por_card
  ON tarefa_pedidos(formulario_id, card_id) WHERE card_id IS NOT NULL AND NOT cancelado;

CREATE TABLE IF NOT EXISTS pedido_montadores (
  email TEXT PRIMARY KEY CHECK (email = LOWER(email)),
  desde TIMESTAMPTZ NOT NULL DEFAULT now(),
  por   UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pedido_leituras (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL CHECK (length(nome_arquivo) BETWEEN 1 AND 300),
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  texto_lido   TEXT,
  usou_ia      BOOLEAN NOT NULL DEFAULT false
);

-- A ação cancelada solta o casamento para um pedido novo; reaberta volta a segurar (se ninguém pediu
-- de novo nesse meio tempo: aí ela fica solta, e o pedido novo é o que vale).
CREATE OR REPLACE FUNCTION pedido_acompanha_situacao() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'cancelada' THEN
      UPDATE tarefa_pedidos SET cancelado = true WHERE tarefa_id = NEW.id AND NOT cancelado;
    ELSE
      UPDATE tarefa_pedidos tp SET cancelado = false
       WHERE tp.tarefa_id = NEW.id AND tp.cancelado
         AND NOT EXISTS (SELECT 1 FROM tarefa_pedidos o
                          WHERE o.formulario_id = tp.formulario_id AND o.card_id = tp.card_id
                            AND o.tarefa_id <> tp.tarefa_id AND NOT o.cancelado);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tarefas_pedido_situacao' AND tgrelid = 'tarefas'::regclass) THEN
    CREATE TRIGGER tarefas_pedido_situacao AFTER UPDATE OF status ON tarefas
      FOR EACH ROW EXECUTE FUNCTION pedido_acompanha_situacao();
  END IF;
END $$;

-- Quem monta os formulários: a lista, ou o administrador.
CREATE OR REPLACE FUNCTION pedido_posso_montar() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT equipe_eu() IS NOT NULL AND (
    equipe_sou_admin()
    OR EXISTS (SELECT 1 FROM users u JOIN pedido_montadores m ON m.email = LOWER(u.email)
                WHERE u.id = equipe_eu() AND u.deleted_at IS NULL))
$$;

-- Quem mexe num pedido além de comentar, ver e anexar: o marketing (quem monta e quem está nos
-- projetos do Notion do marketing no Ações) ou o administrador.
CREATE OR REPLACE FUNCTION pedido_posso_mexer() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT equipe_eu() IS NOT NULL AND (
    pedido_posso_montar()
    OR EXISTS (SELECT 1 FROM quadro_membros qm
                WHERE qm.user_id = equipe_eu()
                  AND qm.quadro_id IN (SELECT np.quadro_id FROM notion_projetos np WHERE np.quadro_id IS NOT NULL
                                       UNION
                                       SELECT nc.quadro_id FROM notion_conexoes nc WHERE nc.ativo AND nc.quadro_id IS NOT NULL)))
$$;

ALTER TABLE pedido_formularios DISABLE ROW LEVEL SECURITY;
ALTER TABLE tarefa_pedidos DISABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_montadores DISABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_leituras DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON pedido_formularios, tarefa_pedidos, pedido_montadores, pedido_leituras FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pedido_formularios, tarefa_pedidos, pedido_montadores, pedido_leituras TO app_tenant, app_writer;
REVOKE ALL ON FUNCTION pedido_acompanha_situacao() FROM PUBLIC;
REVOKE ALL ON FUNCTION pedido_posso_montar() FROM PUBLIC;
REVOKE ALL ON FUNCTION pedido_posso_mexer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pedido_acompanha_situacao() TO app_tenant, app_writer;
GRANT EXECUTE ON FUNCTION pedido_posso_montar() TO app_tenant, app_writer;
GRANT EXECUTE ON FUNCTION pedido_posso_mexer() TO app_tenant, app_writer;

-- ── Semente ─────────────────────────────────────────────────────────────────────────────────────
INSERT INTO pedido_montadores (email) VALUES
  ('vitor@welcometrips.com.br'),
  ('ana@welcometrips.com.br'),
  ('paula@welcometrips.com.br'),
  ('angela@welcometrips.com.br'),
  ('fabiola@welcometrips.com.br')
ON CONFLICT (email) DO NOTHING;

-- Cobertura de casamento: as 14 perguntas que o marketing combinou no Notion + "Casamento" (o seletor).
INSERT INTO pedido_formularios (slug, nome, explica, icone, estado, versao, perguntas, publico, destino)
VALUES (
  'cobertura-casamento',
  'Cobertura de casamento',
  'Peça ao marketing a cobertura de um casamento (fotos, vídeos e stories do dia).',
  '📸',
  'no_ar',
  1,
  '[
    {"id":"quem","tipo":"automatico_quem_pede","rotulo":"Nome de quem está preenchendo","obrigatoria":false,"aceita_nao_temos":false},
    {"id":"casamento","tipo":"casamento","rotulo":"Casamento","obrigatoria":true,"aceita_nao_temos":false},
    {"id":"data","tipo":"data","rotulo":"Data do casamento","obrigatoria":true,"aceita_nao_temos":false,"preenche":"data_casamento"},
    {"id":"casal","tipo":"texto","rotulo":"Nome do casal","obrigatoria":true,"aceita_nao_temos":false,"preenche":"casal"},
    {"id":"instagram_1","tipo":"instagram","rotulo":"Instagram da noiva","obrigatoria":true,"aceita_nao_temos":true,"preenche":"instagram","pessoa":1},
    {"id":"instagram_2","tipo":"instagram","rotulo":"Instagram do noivo","obrigatoria":true,"aceita_nao_temos":true,"preenche":"instagram","pessoa":2},
    {"id":"local","tipo":"texto","rotulo":"Local do casamento","obrigatoria":true,"aceita_nao_temos":false,"preenche":"local"},
    {"id":"programacao","tipo":"paragrafo","rotulo":"Programação","obrigatoria":true,"aceita_nao_temos":true,"preenche":"programacao"},
    {"id":"assessora","tipo":"texto","rotulo":"Assessora","ajuda":"A assessora do dia, no destino","obrigatoria":true,"aceita_nao_temos":true},
    {"id":"contato_assessora","tipo":"telefone_email","rotulo":"Contato da assessora","obrigatoria":true,"aceita_nao_temos":true},
    {"id":"produtora","tipo":"texto","rotulo":"Produtora","ajuda":"Quem cuida deste casamento na Produção","obrigatoria":true,"aceita_nao_temos":false,"preenche":"produtora"},
    {"id":"fornecedores","tipo":"paragrafo","rotulo":"Instagram dos fornecedores","ajuda":"Um por linha: fotógrafo, decoração, DJ…","obrigatoria":true,"aceita_nao_temos":true},
    {"id":"relacionamento","tipo":"paragrafo","rotulo":"Como está o relacionamento do casal com a Welcome Weddings?","obrigatoria":true,"aceita_nao_temos":false},
    {"id":"nao_mostrar","tipo":"paragrafo","rotulo":"O que não devemos mostrar?","obrigatoria":true,"aceita_nao_temos":false},
    {"id":"storymaker","tipo":"sim_nao","rotulo":"Será necessário storymaker?","obrigatoria":true,"aceita_nao_temos":false}
  ]'::jsonb,
  '{"tipo":"empresas","empresas":["Welcome Weddings"],"times":[]}'::jsonb,
  jsonb_build_object(
    'quem_email', 'fabiola@welcometrips.com.br',
    'projeto_notion_page_id', (SELECT np.page_id FROM notion_projetos np WHERE np.nome = 'Rotinas' AND NOT np.no_lixo
                               ORDER BY np.sincronizado_em DESC LIMIT 1),
    'bu', 'Weddings',
    'prioridade', 'alta',
    'prazo', jsonb_build_object('tipo', 'data_casamento'),
    'titulo_modelo', 'Cobertura I {casal} I Pedido'
  )
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;

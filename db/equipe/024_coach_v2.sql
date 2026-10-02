-- Coach v2 no Ações da equipe (02/10/2026): o combinado do dia (8h propõe, 18h pergunta), o placar das vendas lido do
-- TTARS e do site do casal, quem escreveu cada resposta (Coach ou Assistente de tarefas), o medidor dos objetivos e o
-- silêncio no fim de semana. Aditiva e repetível, sem DROP.
BEGIN;

-- Resposta do Assistente de tarefas (lista, concluí, desfaz) fica fora da memória de conversa do Coach.
ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS autor text CHECK (autor IN ('coach','assistente'));

-- Sábado e domingo sem mensagem das 8h e das 18h, a não ser que a pessoa ligue.
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS fim_de_semana boolean NOT NULL DEFAULT false;

-- Objetivo com placar automático: qual número o Coach lê e a meta do mês.
ALTER TABLE objetivos ADD COLUMN IF NOT EXISTS medidor text CHECK (medidor IN ('contratos_ww_mes','convidados_site_mes'));
ALTER TABLE objetivos ADD COLUMN IF NOT EXISTS meta numeric CHECK (meta IS NULL OR meta >= 0);

-- Um combinado por dia: o Coach propõe, a pessoa aceita ("ok") e ele vira ação na lista; às 18h o Coach pergunta.
CREATE TABLE IF NOT EXISTS coach_combinados(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 dia date NOT NULL,
 titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 300),
 ate text CHECK (ate IS NULL OR ate ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 objetivo_id uuid REFERENCES objetivos(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'proposto' CHECK (status IN ('proposto','aceito','feito','nao_deu','adiado','expirado','recusado')),
 origem text NOT NULL DEFAULT 'manha' CHECK (origem IN ('manha','conversa')),
 tarefa_id uuid REFERENCES tarefas(id) ON DELETE SET NULL,
 motivo text CHECK (motivo IS NULL OR length(motivo) <= 1000),
 mensagem_id uuid,
 proposto_em timestamptz NOT NULL DEFAULT now(),
 aceito_em timestamptz,
 resolvido_em timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_combinados_dia ON coach_combinados(user_id,dia DESC,proposto_em DESC);
ALTER TABLE coach_combinados ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_combinados FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='coach_combinados' AND policyname='coach_tenant') THEN
  CREATE POLICY coach_tenant ON coach_combinados FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
 END IF;
END $$;
REVOKE ALL ON coach_combinados FROM PUBLIC;
REVOKE ALL ON coach_combinados FROM anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON coach_combinados TO app_tenant,app_writer;

-- Cada leitura do placar (contratos, negociações e vendas a convidados), para o Coach e para a revisão de sexta.
CREATE TABLE IF NOT EXISTS coach_placar(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 capturado_em timestamptz NOT NULL DEFAULT now(),
 mes text NOT NULL CHECK (mes ~ '^[0-9]{4}-[0-9]{2}$'),
 dados jsonb NOT NULL CHECK (jsonb_typeof(dados)='object')
);
CREATE INDEX IF NOT EXISTS coach_placar_recente ON coach_placar(user_id,capturado_em DESC);
ALTER TABLE coach_placar ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_placar FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='coach_placar' AND policyname='coach_tenant') THEN
  CREATE POLICY coach_tenant ON coach_placar FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
 END IF;
END $$;
REVOKE ALL ON coach_placar FROM PUBLIC;
REVOKE ALL ON coach_placar FROM anon, authenticated;
GRANT SELECT,INSERT ON coach_placar TO app_tenant,app_writer;

COMMIT;

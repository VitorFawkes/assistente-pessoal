-- Pedido direto vira ação nas tarefas (Coach). Aditiva e repetível, sem DROP.
-- coach_task_changes: cada mudança que o Coach fez numa tarefa, com o antes e o depois ("desfaz" e histórico).
-- coach_task_proposals: mudança em tarefa de outra pessoa (ou de quadro com convidado) esperando o "sim".
BEGIN;
CREATE TABLE IF NOT EXISTS coach_task_changes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL,
 run_key text CHECK(length(run_key)<=200),
 tarefa_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('create','complete','cancel','reopen','reschedule','reassign','rename','priority')),
 before jsonb,
 after jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 undone_at timestamptz,
 FOREIGN KEY(tarefa_id,user_id) REFERENCES tarefas(id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS coach_task_changes_run ON coach_task_changes(user_id,run_key) WHERE run_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS coach_task_changes_recent ON coach_task_changes(user_id,created_at DESC) WHERE undone_at IS NULL;
ALTER TABLE coach_task_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_task_changes FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='coach_task_changes' AND policyname='coach_tenant') THEN
  CREATE POLICY coach_tenant ON coach_task_changes FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
 END IF;
END $$;
REVOKE ALL ON coach_task_changes FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON coach_task_changes TO app_tenant,app_writer;

CREATE TABLE IF NOT EXISTS coach_task_proposals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 run_key text CHECK(length(run_key)<=200),
 actions jsonb NOT NULL CHECK(jsonb_typeof(actions)='array'),
 summary text NOT NULL CHECK(length(summary)<=4000),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 resolved_at timestamptz,
 resolution text CHECK(resolution IN ('confirmed','declined','superseded'))
);
CREATE UNIQUE INDEX IF NOT EXISTS coach_task_proposals_run ON coach_task_proposals(user_id,run_key) WHERE run_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS coach_task_proposals_open ON coach_task_proposals(user_id,created_at DESC) WHERE resolved_at IS NULL;
ALTER TABLE coach_task_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_task_proposals FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='coach_task_proposals' AND policyname='coach_tenant') THEN
  CREATE POLICY coach_tenant ON coach_task_proposals FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
 END IF;
END $$;
REVOKE ALL ON coach_task_proposals FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON coach_task_proposals TO app_tenant,app_writer;
COMMIT;

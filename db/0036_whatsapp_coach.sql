-- WhatsApp do Coach (conexão direta pelo servidor coach-whatsapp). Aditiva e repetível.
-- whatsapp_links: tabela de sistema (sem RLS, como sessions): liga um remetente verificado por código a um usuário.
-- whatsapp_messages: entrada e saída por usuário (RLS), com deduplicação e fila de reenvio.
-- whatsapp_channel: estado da conexão do número do Coach (uma linha).
BEGIN;
CREATE TABLE IF NOT EXISTS whatsapp_links (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 phone text CHECK (phone ~ '^[0-9]{8,15}$'),
 lid text CHECK (lid ~ '^[0-9]{5,25}$'),
 code_hash text CHECK (code_hash ~ '^[0-9a-f]{64}$'),
 code_expires_at timestamptz,
 verified_at timestamptz,
 proactive boolean NOT NULL DEFAULT true,
 last_inbound_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (verified_at IS NULL OR phone IS NOT NULL OR lid IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_links_phone ON whatsapp_links(phone) WHERE verified_at IS NOT NULL AND phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_links_lid ON whatsapp_links(lid) WHERE verified_at IS NOT NULL AND lid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_links_code ON whatsapp_links(code_hash) WHERE code_hash IS NOT NULL;
REVOKE ALL ON whatsapp_links FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON whatsapp_links TO app_tenant,app_writer;
COMMENT ON TABLE whatsapp_links IS 'System table (no RLS, like sessions): one verified WhatsApp sender per user; read only by server code before a tenant is known.';

CREATE TABLE IF NOT EXISTS whatsapp_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 direction text NOT NULL CHECK (direction IN ('in','out')),
 kind text NOT NULL CHECK (kind IN ('text','audio','reply','checkin','aviso','link','notice')),
 wa_id text CHECK (length(wa_id) <= 128),
 to_jid text CHECK (to_jid ~ '^[0-9]{5,25}@(s\.whatsapp\.net|lid)$'),
 coach_message_id uuid,
 job_id uuid,
 body text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
 status text NOT NULL CHECK (status IN ('received','batched','ignored','queued','sent','failed')),
 attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
 error text CHECK (length(error) <= 300),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_inbound ON whatsapp_messages(user_id,wa_id) WHERE direction='in' AND wa_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_outbound ON whatsapp_messages(user_id,coach_message_id) WHERE direction='out' AND coach_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_pending ON whatsapp_messages(user_id,status,created_at) WHERE status IN ('received','queued','failed');
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_messages_tenant ON whatsapp_messages;
CREATE POLICY whatsapp_messages_tenant ON whatsapp_messages FOR ALL
 USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid))
 WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
REVOKE ALL ON whatsapp_messages FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON whatsapp_messages TO app_tenant,app_writer;
COMMENT ON TABLE whatsapp_messages IS 'Tenant-scoped WhatsApp traffic of the coach: inbound dedup by WhatsApp id, outbound once per coach message, retried by the 15-minute runner.';

CREATE TABLE IF NOT EXISTS whatsapp_channel (
 id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 state text NOT NULL DEFAULT 'close' CHECK (state IN ('open','connecting','close')),
 state_since timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz NOT NULL DEFAULT now(),
 qr text CHECK (length(qr) <= 20000),
 qr_at timestamptz
);
INSERT INTO whatsapp_channel(id) VALUES (1) ON CONFLICT DO NOTHING;
REVOKE ALL ON whatsapp_channel FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON whatsapp_channel TO app_tenant,app_writer;
COMMENT ON TABLE whatsapp_channel IS 'System table: connection state of the coach WhatsApp number (single row).';
COMMIT;

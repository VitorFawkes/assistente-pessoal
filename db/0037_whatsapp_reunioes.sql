-- Aviso de cada reunião e revisão da semana pelo WhatsApp do Coach. Aditiva e repetível.
-- dedup_key garante um envio só por reunião ('meeting:<id>') e por semana ('review:<data>').
BEGIN;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS dedup_key text CHECK (length(dedup_key) <= 120);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_dedup ON whatsapp_messages(user_id,dedup_key) WHERE dedup_key IS NOT NULL;
COMMIT;

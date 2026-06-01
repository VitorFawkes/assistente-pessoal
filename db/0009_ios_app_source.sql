-- Adiciona 'ios-app' aos valores aceitos em meetings.source.
--
-- Contexto: app iOS nativo TTARS BR (sub-projeto 3 do roadmap multi-tenant)
-- envia source='ios-app' pra diferenciar do 'iphone' antigo (que era Voice
-- Memos via Mac fswatch). Sem isso, INSERT bate em CHECK constraint e a
-- meeting nunca entra — gravação aparece "pendente" pra sempre.
--
-- Idempotente: drop+recreate da constraint.

ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_source_check;

ALTER TABLE meetings
  ADD CONSTRAINT meetings_source_check
  CHECK (source = ANY (ARRAY['macbook'::text, 'iphone'::text, 'ios-app'::text, 'segmented'::text]));

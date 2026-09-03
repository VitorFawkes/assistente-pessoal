-- ─────────────────────────────────────────────────────────────────────
-- 0027_reuniao_share.sql — link de leitura de uma reunião
--
-- Hoje o link de uma reunião só abre pra quem tem sessão: quem recebe cai
-- em /sem-acesso. Este é o mesmo modelo já usado nos quadros (token
-- passwordless + SECURITY DEFINER pra resolver sem contexto de tenant), só
-- que com UM link por reunião — quem recebe LÊ e BAIXA, nunca escreve.
--
-- share_token NULL = reunião não compartilhada (é o estado de todas hoje).
-- Revogar = voltar a NULL: o link morre na hora.
--
-- Aditiva, idempotente, não-destrutiva. Aplicar:
--   psql "$DATABASE_URL" -f db/0027_reuniao_share.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS share_token      TEXT NULL,
  ADD COLUMN IF NOT EXISTS share_created_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN meetings.share_token IS
  'Token do link de leitura (/r/[token]). NULL = não compartilhada.';

-- Índice único parcial: o token é credencial, não pode colidir; NULL não conta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_share_token
  ON meetings(share_token) WHERE share_token IS NOT NULL;

-- Porta única de quem recebe o link: resolve o token SEM contexto de tenant.
-- SECURITY DEFINER → lê através do RLS e devolve só o mínimo pra bootstrapar
-- o acesso (qual reunião, de quem), e só se o token está valendo.
CREATE OR REPLACE FUNCTION resolver_reuniao_token(p_token TEXT)
RETURNS TABLE (meeting_id UUID, owner_id UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.user_id
  FROM meetings m
  WHERE m.share_token = p_token
    AND p_token IS NOT NULL
    AND m.status <> 'archived_session';
$$;
REVOKE ALL ON FUNCTION resolver_reuniao_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_reuniao_token(TEXT) TO app_tenant, app_writer;

COMMIT;

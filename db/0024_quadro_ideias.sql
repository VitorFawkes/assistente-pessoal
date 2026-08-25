-- ─────────────────────────────────────────────────────────────────────
-- 0024_quadro_ideias.sql — página de Ideias dentro do quadro
--
-- Ideia = texto solto, sem prazo e sem dono. Pode virar tarefa (tarefa_id).
-- Apoios (👍) contados por pessoa, para não somar duas vezes.
-- RLS espelha quadros (dono opera via withTenant; convidado via withGuest).
--   psql "$DATABASE_URL" -f db/0024_quadro_ideias.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS quadro_ideias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quadro_id     UUID NOT NULL REFERENCES quadros(id) ON DELETE CASCADE,
  texto         TEXT NOT NULL,
  autor_nome    TEXT NOT NULL,
  autor_convidado_id UUID NULL REFERENCES quadro_convidados(id) ON DELETE SET NULL,
  frente_id     UUID NULL REFERENCES frentes(id) ON DELETE SET NULL,
  tarefa_id     UUID NULL REFERENCES tarefas(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  arquivado_em  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_quadro_ideias_quadro ON quadro_ideias(quadro_id) WHERE arquivado_em IS NULL;

-- Um apoio por pessoa por ideia. "quem" = nome do convidado ou 'dono'.
CREATE TABLE IF NOT EXISTS quadro_ideia_apoios (
  ideia_id   UUID NOT NULL REFERENCES quadro_ideias(id) ON DELETE CASCADE,
  quem       TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ideia_id, quem)
);

ALTER TABLE quadro_ideias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadro_ideias_tenant ON quadro_ideias;
CREATE POLICY quadro_ideias_tenant ON quadro_ideias FOR ALL
  USING (EXISTS (SELECT 1 FROM quadros q WHERE q.id = quadro_ideias.quadro_id));

ALTER TABLE quadro_ideia_apoios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadro_ideia_apoios_tenant ON quadro_ideia_apoios;
CREATE POLICY quadro_ideia_apoios_tenant ON quadro_ideia_apoios FOR ALL
  USING (EXISTS (SELECT 1 FROM quadro_ideias i WHERE i.id = quadro_ideia_apoios.ideia_id));

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- 0010 — Tarefas multidimensionais: frentes + pessoas envolvidas.
-- Aplicar: psql "$DATABASE_URL" -f db/0010_tarefas_multidim.sql
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

-- slugify: lower + remove acento (translate 1:1) + não-alfanum→'-' + trim '-'
CREATE OR REPLACE FUNCTION app_slugify(txt text) RETURNS text AS $$
  SELECT trim(both '-' from regexp_replace(
    lower(translate(coalesce(txt,''),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
      'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuucc')),
    '[^a-z0-9]+', '-', 'g'));
$$ LANGUAGE sql IMMUTABLE;

-- ─── frentes (por usuário) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS frentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_frentes_user ON frentes(user_id) WHERE ativo;

-- ─── tarefa_pessoas (join) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tarefa_pessoas (
  tarefa_id UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  pessoa_id UUID NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  principal BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tarefa_id, pessoa_id)
);
CREATE INDEX IF NOT EXISTS idx_tarefa_pessoas_pessoa ON tarefa_pessoas(pessoa_id);

-- ─── colunas em tarefas ─────────────────────────────────────────────
ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS frente_id UUID NULL REFERENCES frentes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS frente_proposta TEXT NULL,
  ADD COLUMN IF NOT EXISTS pessoas_raw JSONB NULL,
  ADD COLUMN IF NOT EXISTS area_raw TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_tarefas_frente ON tarefas(frente_id) WHERE frente_id IS NOT NULL;

-- ─── trigger BEFORE: area_raw → frente_id | frente_proposta ─────────
CREATE OR REPLACE FUNCTION resolve_tarefa_area() RETURNS trigger AS $$
DECLARE fid uuid;
BEGIN
  IF NEW.area_raw IS NOT NULL AND length(trim(NEW.area_raw)) > 0 AND NEW.frente_id IS NULL THEN
    SELECT id INTO fid FROM frentes
      WHERE user_id = NEW.user_id AND ativo AND slug = app_slugify(NEW.area_raw)
      LIMIT 1;
    IF fid IS NOT NULL THEN
      NEW.frente_id := fid;
    ELSIF NEW.frente_proposta IS NULL THEN
      NEW.frente_proposta := trim(NEW.area_raw);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resolve_tarefa_area ON tarefas;
CREATE TRIGGER trg_resolve_tarefa_area
  BEFORE INSERT ON tarefas
  FOR EACH ROW EXECUTE FUNCTION resolve_tarefa_area();

-- ─── trigger AFTER: pessoas_raw → pessoas + tarefa_pessoas ──────────
CREATE OR REPLACE FUNCTION resolve_tarefa_pessoas() RETURNS trigger AS $$
DECLARE
  v_nome text;
  pid uuid;
  owner_slug text := app_slugify(NEW.owner);
  delegada boolean := NEW.acao IN ('cobrar','aguardar');
  is_principal boolean;
  marcou_principal boolean := false;
BEGIN
  IF NEW.pessoas_raw IS NULL OR jsonb_typeof(NEW.pessoas_raw) <> 'array' THEN
    RETURN NULL;
  END IF;
  FOR v_nome IN SELECT jsonb_array_elements_text(NEW.pessoas_raw) LOOP
    v_nome := trim(v_nome);
    CONTINUE WHEN v_nome = '' OR v_nome = '?' OR app_slugify(v_nome) = 'vitor';
    -- get-or-create pessoa (match por slug do nome OU alias)
    SELECT id INTO pid FROM pessoas
      WHERE user_id = NEW.user_id
        AND (app_slugify(v_nome) = app_slugify(pessoas.nome)
             OR EXISTS (SELECT 1 FROM unnest(pessoas.aliases) a WHERE app_slugify(a) = app_slugify(v_nome)))
      LIMIT 1;
    IF pid IS NULL THEN
      INSERT INTO pessoas (user_id, nome) VALUES (NEW.user_id, v_nome)
        ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now()
        RETURNING id INTO pid;
    END IF;
    -- principal: pessoa do owner se delegada; senão a 1ª válida
    is_principal := (NOT marcou_principal) AND
      (CASE WHEN delegada THEN app_slugify(v_nome) = owner_slug ELSE true END);
    IF is_principal THEN marcou_principal := true; END IF;
    INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal)
      VALUES (NEW.id, pid, is_principal)
      ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal OR tarefa_pessoas.principal;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resolve_tarefa_pessoas ON tarefas;
CREATE TRIGGER trg_resolve_tarefa_pessoas
  AFTER INSERT ON tarefas
  FOR EACH ROW EXECUTE FUNCTION resolve_tarefa_pessoas();

-- ─── RLS + grants (espelha tabelas existentes) ─────────────────────
ALTER TABLE frentes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS frentes_tenant ON frentes;
CREATE POLICY frentes_tenant ON frentes FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

ALTER TABLE tarefa_pessoas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarefa_pessoas_tenant ON tarefa_pessoas;
CREATE POLICY tarefa_pessoas_tenant ON tarefa_pessoas FOR ALL
  USING (EXISTS (SELECT 1 FROM tarefas WHERE tarefas.id = tarefa_pessoas.tarefa_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON frentes, tarefa_pessoas TO app_tenant, app_writer;

-- ─── seed frentes base p/ usuários existentes ──────────────────────
INSERT INTO frentes (user_id, nome, slug, ordem)
SELECT u.id, f.nome, app_slugify(f.nome), f.ord
FROM users u
CROSS JOIN (VALUES
  ('Marketing',1),('Vendas/SDR',2),('Dados & Dashboards',3),('Produto',4),
  ('Trips',5),('Weddings',6),('Edis',7),('Operações',8)
) AS f(nome, ord)
ON CONFLICT (user_id, slug) DO NOTHING;

COMMIT;

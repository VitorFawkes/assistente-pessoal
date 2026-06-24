-- ─────────────────────────────────────────────────────────────────────
-- 0018 — Corrige "principal" em tarefas executar.
--
-- BUG: a trigger resolve_tarefa_pessoas (0010) marcava a 1ª pessoa de
-- pessoas_raw como principal=true mesmo em tarefa acao='executar' (o
-- próprio Vitor executa). O "principal" só faz sentido em tarefa delegada
-- (cobrar/aguardar), pra destacar QUEM vai entregar. Em tarefa executar
-- as pessoas são apenas "envolvidas" (stakeholders), não responsáveis.
--
-- Efeito visível: a tela da reunião (TaskGroupByPerson) agrupa as tarefas
-- "Suas" pela pessoa principal, então tarefas suas apareciam sob o nome de
-- outra pessoa (ex: "Diana · 3") em vez de "Você".
--
-- Fix: principal só quando delegada=true E a pessoa é o owner.
-- Em executar → nenhuma principal → UI cai no fallback "Você", e as pessoas
-- envolvidas seguem aparecendo como chips (a UI já mostra os não-principais).
--
-- Idempotente. Aplicar manual via dbgate/pgweb/psql.
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

-- ─── trigger AFTER: pessoas_raw → pessoas + tarefa_pessoas (corrigida) ──
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
    -- principal: SÓ em tarefa delegada, e SÓ a pessoa do owner.
    -- executar não tem principal (as pessoas são apenas envolvidas).
    is_principal := (NOT marcou_principal) AND delegada AND (app_slugify(v_nome) = owner_slug);
    IF is_principal THEN marcou_principal := true; END IF;
    INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal)
      VALUES (NEW.id, pid, is_principal)
      ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal OR tarefa_pessoas.principal;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ─── backfill: zera principal indevido nas tarefas executar existentes ──
UPDATE tarefa_pessoas tp
   SET principal = false
  FROM tarefas t
 WHERE tp.tarefa_id = t.id
   AND t.acao = 'executar'
   AND tp.principal;

COMMIT;

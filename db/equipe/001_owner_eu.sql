-- Só no banco da equipe (acoes-equipe): o dono da conta é o slug 'eu', não 'vitor'.
-- Mesma função do banco do Vitor, trocando só o slug do dono.

CREATE OR REPLACE FUNCTION public.resolve_tarefa_pessoas() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
    CONTINUE WHEN v_nome = '' OR v_nome = '?' OR app_slugify(v_nome) = 'eu';
    -- get-or-create pessoa (match por slug do nome OU alias)
    SELECT id INTO pid FROM pessoas
      WHERE user_id = NEW.user_id
        AND (app_slugify(v_nome) = app_slugify(pessoas.nome)
             OR EXISTS (SELECT 1 FROM unnest(pessoas.aliases) a WHERE app_slugify(a) = app_slugify(v_nome)))
      LIMIT 1;
    CONTINUE WHEN pid IS NOT NULL AND EXISTS (SELECT 1 FROM pessoas WHERE id = pid AND is_vitor);
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
$$;

ALTER TABLE public.tarefas ALTER COLUMN owner SET DEFAULT 'eu';
ALTER TABLE public.tarefas ALTER COLUMN is_mine SET EXPRESSION AS ((owner = 'eu'::text));

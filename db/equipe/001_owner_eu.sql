-- ─────────────────────────────────────────────────────────────────────
-- db/equipe/001_owner_eu.sql
-- W1: Dono da conta configurável (OWNER_SLUG)
--
-- Trigger resolve_tarefa_pessoas: usa token 'eu' em vez de 'vitor'
-- para referir o dono da conta (compatível com OWNER_SLUG=eu).
--
-- Aplicar APÓS: 0007_multitenant.sql (tabela users, relação com tarefas/pessoas)
--
-- Idempotente: DROP IF EXISTS + CREATE OR REPLACE FUNCTION
-- ─────────────────────────────────────────────────────────────────────

-- Função que resolve "eu" → user_id do dono da tarefa
-- e "pessoa_nome" → pessoa.id na base de dados
CREATE OR REPLACE FUNCTION resolve_tarefa_pessoas()
  RETURNS TRIGGER AS $$
DECLARE
  v_result JSONB := '[]'::JSONB;
  v_item   JSONB;
  v_slot   TEXT;
  v_slug   TEXT;
  v_pessoa_id UUID;
  v_user_id UUID;
BEGIN
  -- Obter user_id da tarefa (pela tabela tarefas se disponível)
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT t.user_id INTO v_user_id
    FROM tarefas t
    WHERE t.id = NEW.tarefa_id;
  ELSE
    SELECT t.user_id INTO v_user_id
    FROM tarefas t
    WHERE t.id = OLD.tarefa_id;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Processar cada slot de pessoas
  FOR v_item IN SELECT jsonb_array_elements(COALESCE(NEW.pessoas_slots, '[]'::JSONB))
  LOOP
    v_slot := v_item ->> 'slot';
    v_slug := v_item ->> 'pessoa_nome';

    -- Resolver o slug
    IF v_slug = 'eu' THEN
      -- 'eu' = pessoa com is_vitor=true do mesmo user
      SELECT p.id INTO v_pessoa_id
      FROM pessoas p
      WHERE p.user_id = v_user_id AND p.is_vitor = TRUE
      LIMIT 1;
    ELSIF v_slug IS NOT NULL THEN
      -- Nome de pessoa (buscar pela tupla user_id, nome)
      SELECT p.id INTO v_pessoa_id
      FROM pessoas p
      WHERE p.user_id = v_user_id AND p.nome = v_slug
      LIMIT 1;
    END IF;

    IF v_pessoa_id IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'slot', v_slot,
        'pessoa_id', v_pessoa_id::TEXT
      );
    END IF;
  END LOOP;

  NEW.pessoas_resolvidas := v_result;
  RETURN NEW;
END $$
LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trig_resolve_tarefa_pessoas ON tarefa_eventos;

CREATE TRIGGER trig_resolve_tarefa_pessoas
  BEFORE INSERT OR UPDATE ON tarefa_eventos
  FOR EACH ROW
  EXECUTE FUNCTION resolve_tarefa_pessoas();

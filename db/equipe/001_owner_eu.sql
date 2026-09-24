-- Migração W1: Suporte a OWNER_SLUG configurável
-- Aplica a trigger resolve_tarefa_pessoas que ignora o slug 'eu' (dono da conta)
-- em vez de hardcoded 'vitor'.
--
-- Esta migração só é aplicada no banco da equipe (acoes-equipe).
-- A instância do Vitor (assistente_pessoal) continua com 'vitor' hardcoded
-- pois OWNER_SLUG não é definido (padrão).

-- Trigger que calcula pessoas principal quando tarefas.owner muda
-- Mantém a coluna tarefa_pessoas.principal consistente com acao/owner:
--   - acao='executar': ninguém é principal (agrupa em "Você")
--   - acao='cobrar'/'aguardar': principal = a pessoa do owner (se não for 'eu'/'?')
--
-- IMPORTANTE: em modo equipe, o slug 'eu' é o dono da conta (variável OWNER_SLUG).
-- Esta trigger o ignora como se fosse o 'vitor' original.
CREATE OR REPLACE FUNCTION resolve_tarefa_pessoas()
RETURNS TRIGGER AS $$
DECLARE
  owner_slug TEXT := current_setting('app.owner_slug', true) OR 'vitor';
BEGIN
  IF (NEW.acao = 'executar') THEN
    -- executar: remove todas as marcações de principal
    DELETE FROM tarefa_pessoas WHERE tarefa_id = NEW.id;
  ELSIF (NEW.owner IS NOT NULL AND trim(NEW.owner) <> '' AND NEW.owner <> '?') THEN
    -- cobrar/aguardar com owner válido e não-'eu'/não-'?':
    -- principal = a pessoa do owner (criar se não existir)

    -- Se o owner é o slug do dono da conta ('eu' em modo equipe, 'vitor' normalmente),
    -- não linkamos ninguém — é como o executar mas guardamos o owner pra referência.
    IF lower(trim(NEW.owner)) = lower(owner_slug) THEN
      DELETE FROM tarefa_pessoas WHERE tarefa_id = NEW.id;
    ELSE
      -- Pessoa real: garante que está marcada principal
      DELETE FROM tarefa_pessoas WHERE tarefa_id = NEW.id;
      INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal)
      SELECT NEW.id, p.id, true FROM pessoas p
      WHERE p.user_id = NEW.user_id AND app_slugify(p.nome) = app_slugify(trim(NEW.owner))
      LIMIT 1
      ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = true;
    END IF;
  ELSE
    -- owner vazio, null ou '?': limpa principal
    DELETE FROM tarefa_pessoas WHERE tarefa_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger executado após INSERT/UPDATE em tarefas
DROP TRIGGER IF EXISTS on_tarefa_owner_acao_change ON tarefas;
CREATE TRIGGER on_tarefa_owner_acao_change
AFTER INSERT OR UPDATE OF owner, acao ON tarefas
FOR EACH ROW
WHEN (NEW.owner IS DISTINCT FROM OLD.owner OR NEW.acao IS DISTINCT FROM OLD.acao OR OLD IS NULL)
EXECUTE FUNCTION resolve_tarefa_pessoas();

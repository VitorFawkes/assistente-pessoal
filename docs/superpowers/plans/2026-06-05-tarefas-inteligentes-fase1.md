# Tarefas Inteligentes — Fase 1 (Dados + IA) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer toda reunião nova gerar tarefas mais exaustivas e ricas, cada uma carregando pessoas envolvidas (incl. não-speakers) e frente/área, resolvidas automaticamente no Postgres.

**Architecture:** A IA (prompt do node "GPT Extract Actions") passa a emitir `pessoas_envolvidas[]` e `area` por ação. O n8n grava esses valores crus em duas colunas novas de `tarefas` (`pessoas_raw` jsonb, `area_raw` text). Dois triggers no Postgres resolvem: BEFORE INSERT casa `area_raw` → `frente_id` (ou `frente_proposta`); AFTER INSERT materializa `pessoas_raw` → get-or-create `pessoas` + `tarefa_pessoas` (marcando a pessoa `principal`). Lógica de resolução fica num lugar só, reusada pelos 3 workflows.

**Tech Stack:** Postgres (plpgsql, triggers), n8n (workflows via JSON no repo + apply.sh/API), `sshpass`+`docker exec` pra rodar SQL no container `n8n_assistente-pessoal-db`.

**Refinamentos vs spec:** resolução via trigger (não nós n8n); em Fase 1 a lista de frentes NÃO é passada pro GPT (ele gera `area` livre, trigger casa por slug) — passar a lista vem na Fase 2 junto da UI de frentes.

---

## Pré-requisitos de ambiente (todas as tasks de DB/n8n)

```bash
cd /Users/vitorgambetti/AssistentePessoal && source .env
DBC=$(sshpass -p "$VPS_ROOT_PASSWORD" ssh -o StrictHostKeyChecking=no "${VPS_SSH_USER}@${VPS_SSH_HOST}" \
  "docker ps --format '{{.Names}}' | grep assistente-pessoal-db | head -1" 2>/dev/null)
# Roda SQL via stdin (suprime warning de collation):
psql_db() { sshpass -p "$VPS_ROOT_PASSWORD" ssh -o StrictHostKeyChecking=no "${VPS_SSH_USER}@${VPS_SSH_HOST}" \
  "docker exec -i $DBC psql -U assistente -d assistente_pessoal -v ON_ERROR_STOP=1" ; }
N8N_URL="${N8N_URL:-https://n8n.vitorgambetti.com.br}"
```

## File Structure

- **Create** `db/0010_tarefas_multidim.sql` — frentes + tarefa_pessoas + colunas em tarefas + `app_slugify` + 2 triggers + seed.
- **Modify** `n8n-workflows/acoes-audio-ingest.json` — node 8 (prompt), node 9 (Parse Actions), node 11 (INSERT tarefas).
- **Modify** `n8n-workflows/acoes-process-segment.json` — node 8 (prompt), Parse Actions, INSERT tarefas.
- **Create** `n8n-workflows/acoes-reprocess-meeting.json` — importar live + sincronizar (acao + novos campos).
- **Modify** `n8n-workflows/apply.sh` — incluir reprocess-meeting.
- **Create** `n8n-workflows/patch-tarefas-multidim.py` — script idempotente que aplica os 3 patches num JSON de workflow (reusado pelos 3).

---

## Task 1: Migration — frentes, tarefa_pessoas, colunas, slugify, triggers, seed

**Files:**
- Create: `db/0010_tarefas_multidim.sql`

- [ ] **Step 1: Escrever a migration completa**

Create `db/0010_tarefas_multidim.sql`:

```sql
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
      'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooooouuuuuuuucc')),
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
  nome text;
  pid uuid;
  owner_slug text := app_slugify(NEW.owner);
  delegada boolean := NEW.acao IN ('cobrar','aguardar');
  is_principal boolean;
  marcou_principal boolean := false;
BEGIN
  IF NEW.pessoas_raw IS NULL OR jsonb_typeof(NEW.pessoas_raw) <> 'array' THEN
    RETURN NULL;
  END IF;
  FOR nome IN SELECT jsonb_array_elements_text(NEW.pessoas_raw) LOOP
    nome := trim(nome);
    CONTINUE WHEN nome = '' OR nome = '?' OR app_slugify(nome) = 'vitor';
    -- get-or-create pessoa (match por slug do nome OU alias)
    SELECT id INTO pid FROM pessoas
      WHERE user_id = NEW.user_id
        AND (app_slugify(nome) = app_slugify(pessoas.nome)
             OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE app_slugify(a) = app_slugify(nome)))
      LIMIT 1;
    IF pid IS NULL THEN
      INSERT INTO pessoas (user_id, nome) VALUES (NEW.user_id, nome)
        ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now()
        RETURNING id INTO pid;
    END IF;
    -- principal: pessoa do owner se delegada; senão a 1ª válida
    is_principal := (NOT marcou_principal) AND
      (CASE WHEN delegada THEN app_slugify(nome) = owner_slug ELSE true END);
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
```

- [ ] **Step 2: Aplicar no banco live**

Run (usa `psql_db` do bloco de pré-requisitos):
```bash
cat db/0010_tarefas_multidim.sql | psql_db
```
Expected: termina com `COMMIT` e sem `ERROR:`.

- [ ] **Step 3: Verificar schema + seed**

Run:
```bash
echo "select count(*) as frentes_vitor from frentes;
select to_regclass('public.tarefa_pessoas') as join_table;
select column_name from information_schema.columns where table_name='tarefas' and column_name in ('frente_id','frente_proposta','pessoas_raw','area_raw') order by 1;
select app_slugify('Vendas/SDR') as slug;" | psql_db
```
Expected: `frentes_vitor` ≥ 8; `join_table` = `tarefa_pessoas`; 4 colunas listadas; `slug` = `vendas-sdr`.

- [ ] **Step 4: Testar os triggers (insert real + assert + cleanup)**

Run:
```bash
echo "
DO \$\$
DECLARE uid uuid; tid uuid; np int; fid uuid;
BEGIN
  SELECT id INTO uid FROM pessoas WHERE is_vitor LIMIT 1;  -- pega user_id real
  SELECT user_id INTO uid FROM pessoas WHERE is_vitor LIMIT 1;
  INSERT INTO tarefas (user_id, titulo, owner, acao, prioridade, status, pessoas_raw, area_raw)
  VALUES (uid, '[TESTE] cobrar Fulano', 'Fulano Teste', 'cobrar', 'media', 'aberta',
          '[\"Fulano Teste\",\"Marcelo\"]'::jsonb, 'Marketing')
  RETURNING id, frente_id INTO tid, fid;
  SELECT count(*) INTO np FROM tarefa_pessoas WHERE tarefa_id = tid;
  RAISE NOTICE 'frente_id set: %, pessoas vinculadas: %, principal owner: %',
    (fid IS NOT NULL), np,
    (SELECT p.nome FROM tarefa_pessoas tp JOIN pessoas p ON p.id=tp.pessoa_id WHERE tp.tarefa_id=tid AND tp.principal);
  DELETE FROM tarefas WHERE id = tid;  -- cleanup (cascata limpa tarefa_pessoas)
  DELETE FROM pessoas WHERE nome IN ('Fulano Teste') ;  -- remove pessoa de teste
END \$\$;" | psql_db
```
Expected: `NOTICE: frente_id set: t, pessoas vinculadas: 2, principal owner: Fulano Teste`.
(Marcelo permanece como pessoa real — ok. "Fulano Teste" é removido.)

- [ ] **Step 5: Commit**

```bash
git add db/0010_tarefas_multidim.sql
git commit -m "feat(db): 0010 tarefas multidimensionais (frentes + tarefa_pessoas + triggers de resolução)"
```

---

## Task 2: Script de patch reusável (prompt + Parse Actions + INSERT)

**Files:**
- Create: `n8n-workflows/patch-tarefas-multidim.py`

- [ ] **Step 1: Escrever o script de patch**

Create `n8n-workflows/patch-tarefas-multidim.py`:

```python
#!/usr/bin/env python3
"""Aplica os patches da Fase 1 (pessoas_envolvidas + area) num JSON de workflow n8n.
Uso: python3 patch-tarefas-multidim.py <arquivo.json> <gpt_node_name> <parse_node_name> <insert_node_name> [--trailing-nl]
Idempotente: pula se já aplicado."""
import json, sys

PROMPT_SECTIONS = """══════════════════════════════════════════════════════════
PESSOAS ENVOLVIDAS (campo: pessoas_envolvidas)
══════════════════════════════════════════════════════════

Para cada ação, liste em "pessoas_envolvidas" as pessoas que a tarefa CONCERNE —
inclusive quem NÃO falou no áudio (ex: "Marcelo", "Estela", "Patrícia").
- Quando acao=cobrar/aguardar, inclua o owner (a pessoa que vai entregar).
- Inclua a pessoa com quem Vitor vai falar/cobrar/alinhar ("Conversar com Marcelo" → ["Marcelo"]).
- Use o nome canônico das "Pessoas conhecidas" quando casar; senão o nome literal dito.
- NÃO inclua "Vitor". Tarefa solo do Vitor → [].
- Em dúvida sobre o nome, prefira incluir o nome dito a omitir.

══════════════════════════════════════════════════════════
FRENTE / ÁREA (campo: area)
══════════════════════════════════════════════════════════

Classifique cada ação numa frente curta em "area": ex "Marketing", "Vendas/SDR",
"Dados & Dashboards", "Produto", "Trips", "Weddings", "Edis", "Operações". Use o
termo mais natural — o sistema casa com a lista do Vitor depois. Sem frente clara → null.

"""

EXHAUST = ("\n- EXAUSTIVIDADE: não junte pendências numa só ação. Cada compromisso "
           "concreto vira uma ação separada; pedidos compostos (faz X e me manda Y) viram 2+ ações.")

# âncora do shape de output (6 espaços de indentação, confirmado no node 8 do audio-ingest)
OLD_SHELL = '      "evidencia": "<trecho literal até 200 chars>",\n'
# adiciona pessoas_envolvidas + area logo após evidencia no shape de output
NEW_SHELL = (OLD_SHELL +
  '      "pessoas_envolvidas": ["<nome>", ...],\n'
  '      "area": "<frente curta ou null>",\n')

def patch_prompt(sysmsg):
    if "pessoas_envolvidas" in sysmsg:
        return sysmsg  # já aplicado
    # 1) injeta seções antes de "FORMATO DO OUTPUT"
    hi = sysmsg.index("FORMATO DO OUTPUT")
    header_line = sysmsg.rfind("\n", 0, hi) + 1
    div_line = sysmsg.rfind("\n", 0, header_line - 1) + 1
    sysmsg = sysmsg[:div_line] + PROMPT_SECTIONS + sysmsg[div_line:]
    # 2) injeta os campos no shape JSON
    assert sysmsg.count(OLD_SHELL) == 1, f"shape anchor count={sysmsg.count(OLD_SHELL)}"
    sysmsg = sysmsg.replace(OLD_SHELL, NEW_SHELL)
    # 3) reforço de exaustividade no bloco ATENÇÃO FINAL
    anchor = "- Prazos vieram do áudio ou eu inventei?"
    if anchor in sysmsg:
        sysmsg = sysmsg.replace(anchor, anchor + EXHAUST)
    return sysmsg

def patch_parse(js):
    if "pessoas_raw" in js:
        return js
    anchor = "acao: ['executar','cobrar','aguardar'].includes(a.acao)"
    line_start = js.rfind("\n", 0, js.index(anchor)) + 1
    inject = ("    pessoas_raw: JSON.stringify(Array.isArray(a.pessoas_envolvidas) ? a.pessoas_envolvidas : []),\n"
              "    area_raw: a.area || null,\n")
    return js[:line_start] + inject + js[line_start:]

def main():
    path, gpt, parse, insert = sys.argv[1:5]
    trailing = "--trailing-nl" in sys.argv
    d = json.load(open(path, encoding="utf-8"))
    nodes = {n["name"]: n for n in d["nodes"]}
    # prompt
    mv = nodes[gpt]["parameters"]["messages"]["values"][0]
    mv["content"] = patch_prompt(mv["content"])
    # parse actions
    pn = nodes[parse]["parameters"]
    pn["jsCode"] = patch_parse(pn["jsCode"])
    # insert mapping
    cols = nodes[insert]["parameters"]["columns"]["value"]
    cols.setdefault("pessoas_raw", "={{ $json.pessoas_raw }}")
    cols.setdefault("area_raw", "={{ $json.area_raw }}")
    out = json.dumps(d, ensure_ascii=False, indent=2) + ("\n" if trailing else "")
    open(path, "w", encoding="utf-8").write(out)
    print(f"patched {path}: pessoas_envolvidas in prompt={'pessoas_envolvidas' in mv['content']}, "
          f"pessoas_raw in parse={'pessoas_raw' in pn['jsCode']}, insert cols={list(cols)[-2:]}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit do script**

```bash
git add n8n-workflows/patch-tarefas-multidim.py
git commit -m "chore(n8n): script de patch tarefas multidim (pessoas_envolvidas + area)"
```

> Nota: os anchors (`OLD_SHELL` e `acao: [...]`) foram confirmados inspecionando os nodes 8/9/11 do audio-ingest nesta sessão; o script segue o mesmo padrão do patch de executive_summary (commit `c09bc68`). Se algum `assert` falhar num workflow, ajustar o anchor pra string exata daquele JSON antes de prosseguir.

---

## Task 3: Aplicar em acoes-audio-ingest

**Files:**
- Modify: `n8n-workflows/acoes-audio-ingest.json` (nodes "8. GPT Extract Actions", "9. Parse Actions", "11. INSERT tarefas")

- [ ] **Step 1: Rodar o patch no JSON do repo**

Run:
```bash
python3 n8n-workflows/patch-tarefas-multidim.py n8n-workflows/acoes-audio-ingest.json \
  "8. GPT Extract Actions" "9. Parse Actions" "11. INSERT tarefas" --trailing-nl
python3 -c "import json; json.load(open('n8n-workflows/acoes-audio-ingest.json')); print('JSON válido')"
```
Expected: linha `patched ...` com os 3 = True/preenchidos, e `JSON válido`.

- [ ] **Step 2: Aplicar no n8n live**

Run:
```bash
source .env; N8N_URL="${N8N_URL:-https://n8n.vitorgambetti.com.br}"
curl -sS -X PUT "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" \
  --data @n8n-workflows/acoes-audio-ingest.json -o /tmp/put.json -w "HTTP %{http_code}\n"
curl -sS "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" -H "X-N8N-API-KEY: $N8N_API_KEY" | grep -c pessoas_envolvidas
```
Expected: `HTTP 200` e contagem ≥ 1.

- [ ] **Step 3: Commit**

```bash
git add n8n-workflows/acoes-audio-ingest.json
git commit -m "feat(n8n/audio-ingest): IA emite pessoas_envolvidas + area; INSERT grava raw"
```

---

## Task 4: Aplicar em acoes-process-segment

**Files:**
- Modify: `n8n-workflows/acoes-process-segment.json`

- [ ] **Step 1: Patch + validar** (process-segment NÃO tem trailing newline — omitir a flag)

Run:
```bash
python3 n8n-workflows/patch-tarefas-multidim.py n8n-workflows/acoes-process-segment.json \
  "8. GPT Extract Actions" "9. Parse Actions" "11. INSERT tarefas"
python3 -c "import json; json.load(open('n8n-workflows/acoes-process-segment.json')); print('JSON válido')"
```
Expected: `patched ...` ok + `JSON válido`.
> Se o INSERT/Parse tiverem nomes de node diferentes nesse workflow, ajustar os args. Confirmar com:
> `python3 -c "import json;[print(n['name']) for n in json.load(open('n8n-workflows/acoes-process-segment.json'))['nodes'] if 'INSERT' in n['name'] or 'Parse' in n['name'] or 'GPT' in n['name']]"`

- [ ] **Step 2: Aplicar live + verificar**

Run:
```bash
source .env; N8N_URL="${N8N_URL:-https://n8n.vitorgambetti.com.br}"
curl -sS -X PUT "$N8N_URL/api/v1/workflows/Gt34r0WVdZxCbJet" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" \
  --data @n8n-workflows/acoes-process-segment.json -o /tmp/put.json -w "HTTP %{http_code}\n"
curl -sS "$N8N_URL/api/v1/workflows/Gt34r0WVdZxCbJet" -H "X-N8N-API-KEY: $N8N_API_KEY" | grep -c pessoas_envolvidas
```
Expected: `HTTP 200` + contagem ≥ 1.

- [ ] **Step 3: Commit**

```bash
git add n8n-workflows/acoes-process-segment.json
git commit -m "feat(n8n/process-segment): IA emite pessoas_envolvidas + area; INSERT grava raw"
```

---

## Task 5: Consertar + versionar acoes-reprocess-meeting

**Files:**
- Create: `n8n-workflows/acoes-reprocess-meeting.json`
- Modify: `n8n-workflows/apply.sh`

Contexto: `acoes-reprocess-meeting` (id `vZJgZV9dqGvrCTv1`) está stale — tem prompt antigo (sem `acao`), Parse/INSERT sem `acao`, e está fora do repo/apply.sh. Vamos sincronizar o prompt com o audio-ingest já patchado (que tem executive_summary + acao + pessoas + area) e os nós Parse/INSERT.

- [ ] **Step 1: Baixar o workflow live e limpar pro formato do repo**

Run:
```bash
source .env; N8N_URL="${N8N_URL:-https://n8n.vitorgambetti.com.br}"
curl -sS "$N8N_URL/api/v1/workflows/vZJgZV9dqGvrCTv1" -H "X-N8N-API-KEY: $N8N_API_KEY" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); \
     [d.pop(k,None) for k in ('id','createdAt','updatedAt','active','tags','versionId','meta','shared','triggerCount','pinData')]; \
     d.get('settings') or d.update(settings={}); \
     open('n8n-workflows/acoes-reprocess-meeting.json','w').write(json.dumps(d,ensure_ascii=False,indent=2))"
python3 -c "import json;print('nodes:',[n['name'] for n in json.load(open('n8n-workflows/acoes-reprocess-meeting.json'))['nodes']])"
```
Expected: lista de nodes incluindo o GPT (`6. GPT Extract Actions`), `7. Parse Actions`, `9. INSERT tarefas`.

- [ ] **Step 2: Copiar o prompt já-bom do audio-ingest pro node GPT do reprocess**

Run:
```bash
python3 - << 'EOF'
import json
src=json.load(open('n8n-workflows/acoes-audio-ingest.json'))
dst=json.load(open('n8n-workflows/acoes-reprocess-meeting.json'))
src_sys=[n for n in src['nodes'] if n['name']=="8. GPT Extract Actions"][0]['parameters']['messages']['values'][0]['content']
g=[n for n in dst['nodes'] if n['type']=='@n8n/n8n-nodes-langchain.openAi'][0]
g['parameters']['messages']['values'][0]['content']=src_sys   # prompt idêntico (exec_summary+acao+pessoas+area)
open('n8n-workflows/acoes-reprocess-meeting.json','w').write(json.dumps(dst,ensure_ascii=False,indent=2))
print('prompt sincronizado; tem acao:', '"acao"' in src_sys, '| pessoas:', 'pessoas_envolvidas' in src_sys)
EOF
```
Expected: `tem acao: True | pessoas: True`.

- [ ] **Step 3: Patch Parse + INSERT do reprocess (acao + raw)**

Run (usa o mesmo script; node names do reprocess):
```bash
python3 n8n-workflows/patch-tarefas-multidim.py n8n-workflows/acoes-reprocess-meeting.json \
  "6. GPT Extract Actions" "7. Parse Actions" "9. INSERT tarefas"
```
Then garantir que o `acao` também é emitido pelo Parse e mapeado no INSERT (o reprocess antigo não tinha):
```bash
python3 - << 'EOF'
import json
d=json.load(open('n8n-workflows/acoes-reprocess-meeting.json'))
nm={n['name']:n for n in d['nodes']}
pj=nm['7. Parse Actions']['parameters']['jsCode']
if "acao:" not in pj:
    anc="prioridade: ['baixa','media','alta','urgente'].includes(a.prioridade)"
    ls=pj.rfind("\n",0,pj.index(anc))+1
    pj=pj[:ls]+"    acao: ['executar','cobrar','aguardar'].includes(a.acao) ? a.acao : (a.owner==='vitor'?'executar':'cobrar'),\n"+pj[ls:]
    nm['7. Parse Actions']['parameters']['jsCode']=pj
cols=nm['9. INSERT tarefas']['parameters']['columns']['value']
cols.setdefault('acao','={{ $json.acao }}')
open('n8n-workflows/acoes-reprocess-meeting.json','w').write(json.dumps(d,ensure_ascii=False,indent=2))
print('acao em parse:', 'acao:' in pj, '| acao em insert:', 'acao' in cols)
EOF
python3 -c "import json;json.load(open('n8n-workflows/acoes-reprocess-meeting.json'));print('JSON válido')"
```
Expected: `acao em parse: True | acao em insert: True` + `JSON válido`.

- [ ] **Step 4: Aplicar live + adicionar ao apply.sh**

Run:
```bash
source .env; N8N_URL="${N8N_URL:-https://n8n.vitorgambetti.com.br}"
curl -sS -X PUT "$N8N_URL/api/v1/workflows/vZJgZV9dqGvrCTv1" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" \
  --data @n8n-workflows/acoes-reprocess-meeting.json -o /tmp/put.json -w "HTTP %{http_code}\n"
```
Expected: `HTTP 200`.

Edit `n8n-workflows/apply.sh` — adicionar após a linha do reprocess-tarefas:
```bash
apply_workflow "vZJgZV9dqGvrCTv1" "acoes-reprocess-meeting.json"   "Acoes - Reprocess Meeting"
```

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/acoes-reprocess-meeting.json n8n-workflows/apply.sh
git commit -m "fix(n8n/reprocess-meeting): sincroniza prompt+acao+pessoas+area; versiona no repo/apply.sh"
```

---

## Task 6: Teste de integração ponta-a-ponta

**Files:** nenhum (verificação)

> Reprocessa a reunião `0bc856aa` (a do funil Vitor×Thiago) pelo webhook já consertado e confere que as tarefas saem com `acao` + pessoas vinculadas + frente. ⚠️ Isso SUBSTITUI as 4 tarefas atuais dessa reunião (esperado — é o teste).

- [ ] **Step 1: Disparar reprocesso**

Run:
```bash
source .env
curl -sS -X POST "$N8N_URL/webhook/acoes-reprocess-meeting" \
  -H "Content-Type: application/json" -H "X-User-Id: $WEBHOOK_USER_ID" \
  -d '{"meeting_id":"0bc856aa-6474-4d18-a82a-3d04071728f9"}' -w "\nHTTP %{http_code}\n"
```
Expected: HTTP 200 (ou 2xx do webhook). Aguardar ~30-60s o GPT processar.

- [ ] **Step 2: Verificar resultado no banco**

Run (usa `psql_db`):
```bash
echo "
select t.titulo, t.acao, t.owner,
       coalesce(f.nome, t.frente_proposta, '—') as frente,
       (select string_agg(p.nome || case when tp.principal then '*' else '' end, ', ')
          from tarefa_pessoas tp join pessoas p on p.id=tp.pessoa_id where tp.tarefa_id=t.id) as pessoas
from tarefas t left join frentes f on f.id=t.frente_id
where t.meeting_id='0bc856aa-6474-4d18-a82a-3d04071728f9'
order by t.created_at;" | psql_db
```
Expected: várias tarefas; cada uma com `acao` preenchida, `frente` ≠ '—' na maioria, e a coluna `pessoas` mostrando vínculos (ex: `Marcelo*` na tarefa do Marcelo, `Thiago*` na do Thiago). A tarefa "Conversar com Marcelo" deve listar `Marcelo*`.

- [ ] **Step 3: Checagem de exaustividade/atribuição (olho humano)**

Comparar a lista nova com a transcrição/resumo: a IA capturou MAIS tarefas que as 4 antigas? Os owners/pessoas batem com quem é quem? Registrar achados; se a extração ainda estiver rasa, ajustar o reforço de prompt (Task 2, `EXHAUST`) e reaplicar (Tasks 3-5).

---

## Self-Review (cobertura do spec)

- Spec §1 (dados: frentes, tarefa_pessoas, colunas) → Task 1. ✓
- Spec §2 (IA: pessoas_envolvidas + area + exaustividade/atribuição) → Tasks 2-5 (prompt). ✓ (passar lista de frentes ao GPT = Fase 2, anotado).
- Spec §3 (pipeline resolução) → triggers (Task 1) + INSERT raw (Tasks 3-5). ✓
- Spec "consertar reprocess-meeting" → Task 5. ✓
- Spec §4 (UI), §5 (backfill assistido), §6 Fase 3 → **fora desta Fase 1** (planos próprios depois). Anotado.

## Riscos conhecidos
- `pessoas_raw` jsonb via n8n: se o PUT/execução falhar ao castar a string JSON pra jsonb, trocar a coluna pra `text` e usar `NEW.pessoas_raw::jsonb` no trigger. Verificar no Task 6 Step 2.
- Reprocesso destrutivo (Task 6) — só na reunião de teste; backfill geral é Fase 3.
- Criação de pessoas a partir de nomes mal-transcritos — monitorar `pessoas` após reprocessos; merge/dedupe é trabalho futuro.
```

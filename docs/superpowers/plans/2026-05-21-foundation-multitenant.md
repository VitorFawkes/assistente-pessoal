# Foundation Multi-Tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o assistente single-user (Vitor) em uma fundação multi-tenant com isolamento estrutural via RLS + helpers tipados, auth roll-own com link de convite, e rollout zero-downtime preservando os dados existentes.

**Architecture:** Postgres com `user_id` + RLS em todas as tabelas escopadas; conexão por request abre transação e seta `app.current_user_id` (filtra automaticamente). Frontend Next.js (App Router) com middleware Node runtime que valida sessão real, helpers tipados por tabela (`meetingsFor(id).list()`), e cookie de sessão 30 dias com sliding expiration. n8n e voice-svc rodam com role Postgres separado (BYPASSRLS) propagando `user_id` explícito vindo do header `X-User-Id`.

**Tech Stack:** Next.js 16 + React 19 + Tailwind 4 + `pg` cru (sem ORM) + Postgres 17 + Python/FastAPI (voice-svc) + n8n + bash (mac-agent).

**Spec de referência:** `docs/superpowers/specs/2026-05-21-foundation-multitenant-design.md`

**Notas sobre testes:** O projeto não usa test runner (sem vitest/jest no frontend, sem pytest no voice-svc) — decisão consciente do dono. Em vez de tarefas TDD clássicas, cada tarefa termina com **verificação concreta** (comando `psql`, `curl` esperado, ou comportamento observável no browser). O espírito é o mesmo: definir o resultado esperado antes de implementar, e provar que rodou.

---

## Mapa de arquivos

**Criados (15):**
- `db/0007_multitenant.sql` — migration completa
- `frontend/lib/auth.ts` — requireUser, requireAdmin, consumeInvite, sessão
- `frontend/lib/queries.ts` — helpers tipados meetingsFor/tarefasFor/pessoasFor/voiceSamplesFor
- `frontend/lib/rate-limit.ts` — bucket in-memory por IP
- `frontend/middleware.ts` — Node runtime, valida sessão real
- `frontend/app/c/[code]/page.tsx` — consumir convite
- `frontend/app/sem-acesso/page.tsx`
- `frontend/app/termos/page.tsx` — aceite LGPD
- `frontend/app/admin/layout.tsx` — requireAdmin no início
- `frontend/app/admin/convites/page.tsx`
- `frontend/app/admin/convites/actions.ts` — Server Actions criar/revogar
- `frontend/app/seguranca/sessoes/page.tsx` — logout-all
- `frontend/app/api/sessao/route.ts` — POST consume invite, DELETE logout
- `frontend/app/api/sessao/revoke-all/route.ts` — POST revoga tudo
- `frontend/components/user-menu.tsx` — avatar + logout

**Modificados (~15):**
- `frontend/lib/db.ts` — adiciona `withTenant`
- `frontend/app/layout.tsx` — header com user-menu
- `frontend/app/page.tsx` — usa tarefasFor
- `frontend/app/reunioes/page.tsx`, `frontend/app/reunioes/[id]/page.tsx`, `frontend/app/reunioes/[id]/identificar/page.tsx`, `frontend/app/reunioes/[id]/segmentar/page.tsx` **[+v2: novo do feature de segmentação já aplicado]**
- `frontend/app/pessoas/page.tsx`, `frontend/app/pessoas/[id]/page.tsx`
- `frontend/app/api/meetings/[id]/identify/route.ts`, `frontend/app/api/meetings/[id]/speakers/route.ts`, `frontend/app/api/meetings/[id]/segments/route.ts` **[+v2: novo do feature de segmentação já aplicado]**
- `frontend/app/api/pessoas/route.ts`, `frontend/app/api/pessoas/[id]/route.ts`
- `frontend/app/api/tarefas/[id]/route.ts`
- `frontend/app/api/samples/[id]/route.ts`
- `frontend/app/api/save-audio/route.ts` — aceita X-User-Id
- `frontend/AGENTS.md` — seção cache safety + auth rules
- `voice-svc/db.py`, `voice-svc/main.py`
- `mac-agent/audio-watcher.sh`, `.env.example`
- `n8n-workflows/acoes-audio-ingest.json` + update no n8n via curl

---

# FASE 0 — Pré-requisitos de infra (roles Postgres)

> RLS só funciona com role sem `SUPERUSER`/`BYPASSRLS`. Atualmente todos os serviços conectam com role único (provavelmente `postgres` que bypassa RLS). Precisa criar 2 roles separados antes de qualquer outra coisa.

### Task 0.1 — Verificar role atual do `DATABASE_URL` em produção

**Files:** nenhum (só leitura)

- [ ] **Step 1: Conectar no Postgres de produção (easypanel) e descobrir o user atual**

```bash
source /Users/vitorgambetti/AssistentePessoal/.env
psql "$DATABASE_URL" -c "SELECT current_user, current_setting('is_superuser') AS superuser, rolbypassrls FROM pg_roles WHERE rolname = current_user;"
```

Expected output: uma linha mostrando o role atual e se ele bypassa RLS. Se `rolbypassrls = t` ou `superuser = on`, **confirmado** que precisamos de roles separados.

- [ ] **Step 2: Anotar o nome do role atual** (provavelmente `postgres`). Será mantido pro voice-svc + n8n; um novo role `app_tenant` será criado pro frontend.

Anotar mentalmente / em comentário no PR. Sem ação no DB ainda.

### Task 0.2 — Criar roles `app_tenant` e `app_writer`

**Files:**
- Não cria arquivo — DDL aplicada via psql

- [ ] **Step 1: Gerar senhas seguras pros roles**

```bash
TENANT_PWD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 24)
WRITER_PWD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 24)
echo "app_tenant: $TENANT_PWD"
echo "app_writer: $WRITER_PWD"
```

Anotar as duas senhas em local seguro (1Password/keychain). Serão usadas nos `.env`.

- [ ] **Step 2: Criar os roles no Postgres**

```bash
psql "$DATABASE_URL" <<SQL
CREATE ROLE app_tenant LOGIN PASSWORD '$TENANT_PWD' NOBYPASSRLS;
CREATE ROLE app_writer LOGIN PASSWORD '$WRITER_PWD' BYPASSRLS;

GRANT CONNECT ON DATABASE postgres TO app_tenant, app_writer;
GRANT USAGE ON SCHEMA public TO app_tenant, app_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant, app_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant, app_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant, app_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_tenant, app_writer;
SQL
```

> **Atenção:** o nome do database real pode ser diferente de `postgres`. Confira com `psql "$DATABASE_URL" -c "SELECT current_database();"` antes.

- [ ] **Step 3: Verificar que os roles foram criados**

```bash
psql "$DATABASE_URL" -c "SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('app_tenant', 'app_writer') ORDER BY rolname;"
```

Expected: 2 linhas. `app_tenant` com `rolbypassrls=f`, `app_writer` com `rolbypassrls=t`.

- [ ] **Step 4: Construir as URLs novas**

A URL original tem formato `postgres://user:pass@host:port/db`. Gere duas variantes substituindo `user:pass`:

```
DATABASE_URL_TENANT=postgres://app_tenant:<pwd>@<host>:<port>/<db>
DATABASE_URL_WRITER=postgres://app_writer:<pwd>@<host>:<port>/<db>
```

Anotar — vai pros `.env` na Task 0.3.

- [ ] **Step 5: Testar conexão com role novo**

```bash
psql "$DATABASE_URL_TENANT" -c "SELECT 1;"
psql "$DATABASE_URL_WRITER" -c "SELECT 1;"
```

Expected: ambos retornam `?column? = 1`. Se falhar, revisar grants.

### Task 0.3 — Atualizar `.env` dos serviços com novos DATABASE_URLs

**Files:**
- Modify: `.env` do frontend (easypanel UI)
- Modify: `.env` do voice-svc (easypanel UI)
- Modify: `.env` do n8n (easypanel UI ou env vars do workflow)

> Esses `.env` vivem no easypanel, não no repo. Atualiza via UI do easypanel pra cada service. Não há arquivo local pra editar.

- [ ] **Step 1: Atualizar frontend (`n8n_assistente-frontend`) no easypanel**

Substituir `DATABASE_URL` pelo novo `DATABASE_URL_TENANT`. Service ainda está rodando com schema antigo (sem RLS) → conexão funciona normal.

- [ ] **Step 2: Atualizar voice-svc no easypanel**

Substituir `DATABASE_URL` pelo `DATABASE_URL_WRITER`. Voice-svc precisa de bypass porque vai propagar `user_id` explícito.

- [ ] **Step 3: Atualizar n8n no easypanel**

n8n usa credenciais Postgres internas (credentials da UI). Atualizar a credencial usada pelo workflow `Acoes - Audio Ingest` pra usar `app_writer`.

- [ ] **Step 4: Verificar que os 3 serviços continuam funcionando**

```bash
# frontend (URL pública)
curl -s https://n8n-assistente-frontend.tatetz.easypanel.host/api/health
# voice-svc (proxy via frontend)
curl -s https://n8n-assistente-frontend.tatetz.easypanel.host/api/voice-svc/health
# n8n
source /Users/vitorgambetti/AssistentePessoal/.env
curl -s "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" -H "X-N8N-API-KEY: $N8N_API_KEY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('workflow active:', d.get('active'))"
```

Expected: frontend OK, voice-svc OK, n8n workflow ativo. Se algum falhar, problema de grants.

- [ ] **Step 5: Commit (placeholder — nenhuma mudança de arquivo nesse passo, mas documenta no projeto)**

Sem commit nesta task — mudanças foram na infra. **Crie uma nota local** em `/Users/vitorgambetti/AssistentePessoal/ROLES_NOTES.md` (gitignored) com as senhas anotadas e timestamp:

```
2026-05-21: app_tenant + app_writer roles criados.
DATABASE_URL_TENANT e DATABASE_URL_WRITER aplicados em frontend/voice-svc/n8n.
Role legado (postgres) ainda existe — não remover, só os apps trocaram.
```

---

# FASE 1 — Migration 0007 (schema + backfill + RLS)

> **[v2 nota:]** o número original do plano era `0006`, mas outro feature em paralelo (segmentação de áudio longo) tomou o slot 0006 (`0006_meeting_segmentation.sql` já aplicada em prod). Por isso usamos `0007`.

### Task 1.1 — Criar `db/0007_multitenant.sql` com tabelas novas + ALTERs + índices

**Files:**
- Create: `db/0007_multitenant.sql`

- [ ] **Step 1: Criar o arquivo com header + tabelas novas (users, invites, sessions, audit_log, usage_events)**

```bash
mkdir -p /Users/vitorgambetti/AssistentePessoal/db
```

Conteúdo do arquivo:

```sql
-- ─────────────────────────────────────────────────────────────────────
-- db/0007_multitenant.sql
-- Foundation multi-tenant: tabelas users/invites/sessions/audit_log/usage_events,
-- user_id em tabelas existentes, backfill pro Vitor, CHECK NOT VALID + VALIDATE,
-- RLS habilitada com policies, índices compostos.
--
-- Aplicar:
--   psql "$DATABASE_URL" -f db/0007_multitenant.sql
--
-- Idempotente: todas DDLs com IF [NOT] EXISTS.
-- ─────────────────────────────────────────────────────────────────────

-- ─── users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  email            TEXT,
  whatsapp         TEXT,
  is_admin         BOOLEAN NOT NULL DEFAULT FALSE,
  consent_terms_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active
  ON users(email) WHERE email IS NOT NULL AND deleted_at IS NULL;

-- ─── invites ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invites (
  code           TEXT PRIMARY KEY,
  nome_sugerido  TEXT NOT NULL,
  created_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at    TIMESTAMPTZ,
  consumed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invites_unused
  ON invites(created_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- ─── sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address    INET,
  user_agent    TEXT,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions(user_id) WHERE revoked_at IS NULL;

-- ─── audit_log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_id   TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_created  ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_log(action,  created_at DESC);

-- ─── usage_events (placeholder pro sub-projeto 4) ─────────────────────
CREATE TABLE IF NOT EXISTS usage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id  UUID REFERENCES meetings(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  units       NUMERIC NOT NULL,
  cost_usd    NUMERIC NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_user_created
  ON usage_events(user_id, created_at DESC);

-- ─── ALTERs em tabelas existentes ─────────────────────────────────────
ALTER TABLE meetings       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE tarefas        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE pessoas        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE voice_samples  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;

-- ─── Índices compostos (otimizados pra padrão de query real) ──────────
DROP INDEX IF EXISTS idx_meetings_status;
CREATE INDEX IF NOT EXISTS idx_meetings_user_status   ON meetings(user_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_user_recorded ON meetings(user_id, recorded_at DESC);

DROP INDEX IF EXISTS idx_tarefas_status_abertas;
CREATE INDEX IF NOT EXISTS idx_tarefas_user_status_abertas
  ON tarefas(user_id, status)
  WHERE status NOT IN ('concluida','cancelada');
CREATE INDEX IF NOT EXISTS idx_tarefas_user_prazo
  ON tarefas(user_id, prazo)
  WHERE prazo IS NOT NULL AND status NOT IN ('concluida','cancelada');

CREATE INDEX IF NOT EXISTS idx_voice_samples_user_active
  ON voice_samples(user_id) WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pessoas_user ON pessoas(user_id);

-- ─── Pessoas: UNIQUE vira (user_id, nome) ─────────────────────────────
ALTER TABLE pessoas DROP CONSTRAINT IF EXISTS pessoas_nome_key;
ALTER TABLE pessoas ADD CONSTRAINT pessoas_user_nome_key UNIQUE (user_id, nome);
```

- [ ] **Step 2: Verificar que o arquivo é SQL válido (sem aplicar)**

```bash
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -1 -c "BEGIN; \i /Users/vitorgambetti/AssistentePessoal/db/0007_multitenant.sql; ROLLBACK;"
```

> O `BEGIN ... ROLLBACK` permite testar a sintaxe SQL sem mudar o DB. Vai falhar nos GRANTs/etc se houver erro de sintaxe; passar = SQL ok.

Expected: comando termina sem erro (mensagem "ROLLBACK" no fim, sem `ERROR:` antes).

- [ ] **Step 3: Commit do arquivo (ainda não aplicado em prod)**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add db/0007_multitenant.sql
git commit -m "$(cat <<'EOF'
feat(db): 0006 multitenant — tabelas + ALTERs + índices compostos

Parte 1 da migration (sem backfill, sem RLS ainda — vêm em commits
separados). Cria users, invites, sessions, audit_log, usage_events;
adiciona user_id nullable em meetings/tarefas/pessoas/voice_samples;
substitui índices single-column por compostos otimizados pro padrão
de query real (user_id, status / user_id, recorded_at DESC etc).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.2 — Adicionar backfill (DO block) ao `db/0007_multitenant.sql`

**Files:**
- Modify: `db/0007_multitenant.sql` (append no final)

- [ ] **Step 1: Append do backfill no arquivo**

Adicionar ao fim de `db/0007_multitenant.sql`:

```sql
-- ─── Backfill: cria Vitor (user_id=primeiro admin) e atribui tudo ─────
DO $$
DECLARE
  vitor_id UUID;
BEGIN
  INSERT INTO users (nome, is_admin, consent_terms_at)
  SELECT 'Vitor', TRUE, now()
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin = TRUE AND deleted_at IS NULL)
  RETURNING id INTO vitor_id;

  IF vitor_id IS NULL THEN
    SELECT id INTO vitor_id FROM users
    WHERE is_admin = TRUE AND deleted_at IS NULL LIMIT 1;
  END IF;

  UPDATE meetings      SET user_id = vitor_id WHERE user_id IS NULL;
  UPDATE tarefas       SET user_id = vitor_id WHERE user_id IS NULL;
  UPDATE pessoas       SET user_id = vitor_id WHERE user_id IS NULL;
  UPDATE voice_samples SET user_id = vitor_id WHERE user_id IS NULL;

  INSERT INTO audit_log (user_id, action, metadata)
  VALUES (vitor_id, 'backfill.completed', jsonb_build_object('migrated_at', now()));
END $$;
```

- [ ] **Step 2: Re-validar sintaxe**

```bash
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -1 -c "BEGIN; \i /Users/vitorgambetti/AssistentePessoal/db/0007_multitenant.sql; ROLLBACK;"
```

Expected: termina sem ERROR. (O backfill RODA dentro do BEGIN, então também escreve no audit_log temporariamente, mas o ROLLBACK desfaz.)

- [ ] **Step 3: Commit incremental**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add db/0007_multitenant.sql
git commit -m "feat(db): 0007 — backfill (Vitor como user_id padrão dos dados existentes)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.3 — Adicionar CHECK NOT VALID + VALIDATE ao `0007_multitenant.sql`

**Files:**
- Modify: `db/0007_multitenant.sql` (append)

- [ ] **Step 1: Append dos CHECK constraints**

```sql
-- ─── NOT NULL via CHECK CONSTRAINT NOT VALID (lock fraco) ─────────────
-- ADD CONSTRAINT NOT VALID = ShareUpdateExclusiveLock (permite SELECT/UPDATE simultâneos)
-- VALIDATE CONSTRAINT = ShareLock (também permite leituras)
-- Alternativa a SET NOT NULL que precisaria de AccessExclusiveLock + full scan
ALTER TABLE meetings      ADD CONSTRAINT meetings_user_id_not_null      CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE tarefas       ADD CONSTRAINT tarefas_user_id_not_null       CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE pessoas       ADD CONSTRAINT pessoas_user_id_not_null       CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE voice_samples ADD CONSTRAINT voice_samples_user_id_not_null CHECK (user_id IS NOT NULL) NOT VALID;

ALTER TABLE meetings      VALIDATE CONSTRAINT meetings_user_id_not_null;
ALTER TABLE tarefas       VALIDATE CONSTRAINT tarefas_user_id_not_null;
ALTER TABLE pessoas       VALIDATE CONSTRAINT pessoas_user_id_not_null;
ALTER TABLE voice_samples VALIDATE CONSTRAINT voice_samples_user_id_not_null;
```

- [ ] **Step 2: Validar sintaxe**

```bash
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -1 -c "BEGIN; \i /Users/vitorgambetti/AssistentePessoal/db/0007_multitenant.sql; ROLLBACK;"
```

Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add db/0007_multitenant.sql
git commit -m "feat(db): 0007 — CHECK NOT VALID + VALIDATE (lock fraco em vez de SET NOT NULL)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.4 — Adicionar RLS habilitada + policies ao `0007_multitenant.sql`

**Files:**
- Modify: `db/0007_multitenant.sql` (append)

- [ ] **Step 1: Append do RLS**

```sql
-- ─── RLS: row-level security em tabelas escopadas ─────────────────────
-- Aplicação seta SET LOCAL app.current_user_id = '<uuid>' por transação.
-- App connection role NÃO deve ter BYPASSRLS (app_tenant). n8n e voice-svc
-- usam app_writer (BYPASSRLS) e propagam user_id explícito.

ALTER TABLE meetings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pessoas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_samples  ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefa_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meetings_tenant      ON meetings;
DROP POLICY IF EXISTS tarefas_tenant       ON tarefas;
DROP POLICY IF EXISTS pessoas_tenant       ON pessoas;
DROP POLICY IF EXISTS voice_samples_tenant ON voice_samples;
DROP POLICY IF EXISTS usage_events_tenant  ON usage_events;
DROP POLICY IF EXISTS tarefa_eventos_tenant ON tarefa_eventos;

CREATE POLICY meetings_tenant       ON meetings       FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY tarefas_tenant        ON tarefas        FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY pessoas_tenant        ON pessoas        FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY voice_samples_tenant  ON voice_samples  FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY usage_events_tenant   ON usage_events   FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY tarefa_eventos_tenant ON tarefa_eventos FOR ALL USING (EXISTS (SELECT 1 FROM tarefas WHERE tarefas.id = tarefa_eventos.tarefa_id));
```

- [ ] **Step 2: Validar sintaxe**

```bash
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -1 -c "BEGIN; \i /Users/vitorgambetti/AssistentePessoal/db/0007_multitenant.sql; ROLLBACK;"
```

Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add db/0007_multitenant.sql
git commit -m "feat(db): 0007 — RLS habilitada + policies (defesa em profundidade)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.5 — Aplicar `0007_multitenant.sql` em produção

**Files:** nenhum (DDL em prod)

> **Janela ruim curta:** entre apply e deploy do frontend novo (Fase 3), o frontend antigo (que conecta como `app_tenant` agora, sem BYPASSRLS) **vai falhar todas as leituras** das tabelas com RLS porque ainda não seta `app.current_user_id`. Por isso essa task fica grupada com a Fase 3 num único maintenance window. Execute essa task imediatamente antes do deploy da Fase 3.

- [ ] **Step 1: Backup do banco antes da migration**

Use o dbgate ou pgweb (apontado no AGENTS.md) pra fazer dump completo. Ou via CLI:

```bash
source /Users/vitorgambetti/AssistentePessoal/.env
DUMP_FILE="/tmp/backup-pre-0007-$(date +%Y%m%d-%H%M%S).sql"
pg_dump "$DATABASE_URL" > "$DUMP_FILE"
echo "Backup em: $DUMP_FILE — tamanho: $(stat -f%z "$DUMP_FILE") bytes"
```

Anote o path. Se algo der errado, restaura.

- [ ] **Step 2: Aplicar a migration**

```bash
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -f /Users/vitorgambetti/AssistentePessoal/db/0007_multitenant.sql
```

Expected: vários `CREATE TABLE`/`ALTER TABLE`/`CREATE INDEX`/`DO`/`ALTER TABLE VALIDATE` — sem `ERROR`.

- [ ] **Step 3: Verificar backfill saneado**

```bash
psql "$DATABASE_URL" <<SQL
SELECT 'meetings'      AS tabela, count(*) AS total, count(*) FILTER (WHERE user_id IS NULL) AS sem_user FROM meetings
UNION ALL SELECT 'tarefas', count(*), count(*) FILTER (WHERE user_id IS NULL) FROM tarefas
UNION ALL SELECT 'pessoas', count(*), count(*) FILTER (WHERE user_id IS NULL) FROM pessoas
UNION ALL SELECT 'voice_samples', count(*), count(*) FILTER (WHERE user_id IS NULL) FROM voice_samples;
SQL
```

Expected: coluna `sem_user` deve ser 0 em todas as linhas.

- [ ] **Step 4: Verificar RLS habilitada**

```bash
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity ORDER BY tablename;"
```

Expected: 6 linhas — meetings, tarefas, pessoas, voice_samples, usage_events, tarefa_eventos.

- [ ] **Step 5: Anotar o UUID do Vitor pra usar em outras tasks**

```bash
VITOR_UUID=$(psql "$DATABASE_URL" -At -c "SELECT id FROM users WHERE is_admin AND deleted_at IS NULL LIMIT 1;")
echo "VITOR_UUID=$VITOR_UUID"
```

Anote esse UUID — será usado em: criação de sessão manual (Task 3.1), `WEBHOOK_USER_ID` do mac-agent (Task 6.4), `VITOR_FALLBACK_UUID` do n8n (Task 6.3).

- [ ] **Step 6: Sem commit nesta task (DDL em prod, código já comitado)**

---

# FASE 2 — Libs novas no frontend

> A partir daqui é tudo código no repo. Cada arquivo novo + uma verificação rápida (compile/lint/sanity check).

### Task 2.1 — Adicionar `withTenant` ao `frontend/lib/db.ts`

**Files:**
- Modify: `frontend/lib/db.ts`

- [ ] **Step 1: Editar arquivo pra adicionar a função**

Substituir todo o conteúdo de `frontend/lib/db.ts` por:

```typescript
import { Pool, type PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definida no ambiente");
  }
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getPool(): Pool {
  if (!global.__pgPool) {
    global.__pgPool = makePool();
  }
  return global.__pgPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(text, values);
  return res.rows as T[];
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/**
 * Roda `fn` dentro de uma transação com `app.current_user_id` setado.
 * RLS no Postgres filtra automaticamente queries por user_id.
 * Usar em TODOS os pontos que retornam dados de tabelas escopadas (meetings,
 * tarefas, pessoas, voice_samples, usage_events, tarefa_eventos).
 *
 * Endpoints "de sistema" (sessions/invites/users lookup) usam `query` direto.
 */
export async function withTenant<T>(
  userId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}
```

- [ ] **Step 2: Verificar que tipa**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | head -20
```

Expected: sem erro relacionado a `lib/db.ts`.

- [ ] **Step 3: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/lib/db.ts
git commit -m "feat(db): withTenant — transação com SET LOCAL app.current_user_id (RLS)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.2 — Criar `frontend/lib/rate-limit.ts`

**Files:**
- Create: `frontend/lib/rate-limit.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
/**
 * Rate limiter in-memory por chave (tipicamente IP).
 * Suficiente pra instância única; migrar pra Postgres-backed se virar multi-replica.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  maxRequests = 5,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (arr.length >= maxRequests) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

/** Pega o IP do cliente respeitando proxies. */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
```

- [ ] **Step 2: Validar com sanity check rápido em Node**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsx -e "
import { rateLimit } from './lib/rate-limit.ts';
const key = 'test';
for (let i = 1; i <= 7; i++) {
  console.log(\`Request \${i}: \${rateLimit(key, 5, 60_000) ? 'OK' : 'BLOCKED'}\`);
}
"
```

Expected: requests 1-5 = OK, 6-7 = BLOCKED.

> Se `bunx tsx` não estiver disponível, criar arquivo `/tmp/test-rl.ts` com mesmo conteúdo e rodar `bunx tsx /tmp/test-rl.ts`. Se nem isso funcionar, pular e confiar no review humano — esse é um módulo trivial.

- [ ] **Step 3: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/lib/rate-limit.ts
git commit -m "feat(lib): rate-limit in-memory por IP

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3 — Criar `frontend/lib/auth.ts`

**Files:**
- Create: `frontend/lib/auth.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
import { cookies } from "next/headers";
import { query } from "./db";

const COOKIE_NAME = "session";
const SESSION_TTL_DAYS = 30;
const SESSION_MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60;

export type User = {
  id: string;
  nome: string;
  email: string | null;
  whatsapp: string | null;
  is_admin: boolean;
  consent_terms_at: string | null;
  deleted_at: string | null;
};

export class AuthError extends Error {
  constructor(public status: 401 | 403) {
    super(`auth ${status}`);
  }
}

export class InviteError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Retorna o user da sessão atual. Atualiza last_used_at (sliding expiration).
 * Throws AuthError(401) se sessão inválida/expirada/revogada.
 *
 * SOMENTE chamar em Route Handlers e Server Actions (têm error handling explícito).
 * Em Server Components, chamar via wrapper que catch AuthError e redirect.
 */
export async function requireUser(): Promise<User> {
  const sessionId = (await cookies()).get(COOKIE_NAME)?.value;
  if (!sessionId) throw new AuthError(401);

  const cutoff = new Date(Date.now() - SESSION_MAX_AGE * 1000).toISOString();
  const rows = await query<{ user: User | null }>(
    `
    UPDATE sessions s SET last_used_at = now()
    WHERE s.id = $1 AND s.revoked_at IS NULL AND s.last_used_at > $2
    RETURNING (
      SELECT row_to_json(u)
      FROM users u
      WHERE u.id = s.user_id AND u.deleted_at IS NULL
    ) AS user
    `,
    [sessionId, cutoff],
  );
  const user = rows[0]?.user;
  if (!user) throw new AuthError(401);
  return user;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (!u.is_admin) throw new AuthError(403);
  return u;
}

/**
 * Consome o convite atomicamente. Race-safe: o `UPDATE` com RETURNING garante
 * que apenas uma das requisições concorrentes ganha o claim.
 *
 * Sequência:
 *   1. Cria o user candidato.
 *   2. UPDATE invites SET consumed_by=$novo_user WHERE code AND não consumido.
 *   3. Se RETURNING vazio (alguém ganhou primeiro), apaga o user criado e throw.
 *   4. Cria sessão + audit log.
 */
export async function consumeInvite(
  code: string,
  nome: string,
  ip: string | null,
  userAgent: string,
): Promise<{ user: User; sessionId: string }> {
  const userRows = await query<{ id: string }>(
    `INSERT INTO users (nome) VALUES ($1) RETURNING id`,
    [nome],
  );
  const newUserId = userRows[0].id;

  const claimRows = await query<{ consumed_by: string }>(
    `
    UPDATE invites
    SET consumed_at = now(), consumed_by = $2
    WHERE code = $1 AND consumed_at IS NULL AND revoked_at IS NULL
    RETURNING consumed_by
    `,
    [code, newUserId],
  );

  if (claimRows.length === 0 || claimRows[0].consumed_by !== newUserId) {
    await query(`DELETE FROM users WHERE id = $1`, [newUserId]);
    throw new InviteError("Invite inválido ou já consumido");
  }

  const sessionRows = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, ip_address, user_agent)
     VALUES ($1, $2, $3) RETURNING id`,
    [newUserId, ip, (userAgent || "").slice(0, 500)],
  );
  const sessionId = sessionRows[0].id;

  await query(
    `INSERT INTO audit_log (user_id, action, target_id, metadata)
     VALUES ($1, 'invite.consume', $2, $3)`,
    [newUserId, code, JSON.stringify({ ip, user_agent: userAgent })],
  );

  const userFull = await query<User>(
    `SELECT id, nome, email, whatsapp, is_admin, consent_terms_at, deleted_at
       FROM users WHERE id = $1`,
    [newUserId],
  );

  return { user: userFull[0], sessionId };
}

export async function setSessionCookie(sessionId: string): Promise<void> {
  (await cookies()).set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(sessionId: string): Promise<void> {
  await query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
  (await cookies()).delete(COOKIE_NAME);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  await query(
    `INSERT INTO audit_log (user_id, action, metadata)
     VALUES ($1, 'session.revoke_all', '{}'::jsonb)`,
    [userId],
  );
}

export async function getCurrentSessionId(): Promise<string | null> {
  return (await cookies()).get(COOKIE_NAME)?.value ?? null;
}
```

- [ ] **Step 2: Verificar que tipa**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep "lib/auth" | head -10
```

Expected: nenhuma linha.

- [ ] **Step 3: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/lib/auth.ts
git commit -m "feat(auth): requireUser/requireAdmin/consumeInvite + cookie sessão 30d

- Cookie httpOnly+secure+SameSite=Lax, TTL 30d sliding via last_used_at
- consumeInvite atomic claim (race-safe via UPDATE RETURNING)
- revokeAllSessions pra logout-all-devices
- AuthError 401/403, InviteError pra rejeição limpa

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.4 — Criar `frontend/lib/queries.ts` (helpers tipados)

**Files:**
- Create: `frontend/lib/queries.ts`

> **Decisão de escopo:** esse arquivo define helpers pra **todas** as tabelas escopadas que o frontend usa hoje. As queries internas não precisam de `WHERE user_id = ...` porque RLS já filtra — mas é boa prática deixar implícito que a função carrega o escopo via nome.

- [ ] **Step 1: Inspecionar o que cada página existente consulta (pra cobrir tudo)**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
grep -rn "query<\|query(" app/ --include="*.tsx" --include="*.ts" | head -40
```

Use o output pra mapear: cada SELECT/UPDATE/INSERT/DELETE atual deve ter contrapartida em `queries.ts`.

- [ ] **Step 2: Criar arquivo com helpers iniciais**

```typescript
import { withTenant } from "./db";

// ─── Tipos ────────────────────────────────────────────────────────────

export type Meeting = {
  id: string;
  user_id: string;
  source: "macbook" | "iphone";
  meeting_type: "online" | "presencial" | "desconhecido" | null;
  original_filename: string;
  audio_path: string;
  audio_size_bytes: number | null;
  duration_seconds: number | null;
  recorded_at: string | null;
  status: "received" | "transcribing" | "analyzing" | "done" | "error";
  status_error: string | null;
  transcription: string | null;
  summary: string | null;
  raw_ai_response: unknown;
  speaker_labels: Record<string, string> | null;
  speaker_pessoas: Record<string, string> | null;
  speaker_labels_proposed: Record<string, unknown> | null;
  created_at: string;
  done_at: string | null;
};

export type Tarefa = {
  id: string;
  user_id: string;
  meeting_id: string | null;
  titulo: string;
  descricao: string | null;
  owner: string;
  is_mine: boolean;
  prazo: string | null;
  prazo_text: string | null;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  status: "aberta" | "em_andamento" | "concluida" | "cancelada";
  evidencia: string | null;
  created_at: string;
  updated_at: string;
  concluida_em: string | null;
  cancelada_em: string | null;
};

export type Pessoa = {
  id: string;
  user_id: string;
  nome: string;
  aliases: string[];
  is_vitor: boolean;
  notas: string | null;
  created_at: string;
  updated_at: string;
};

export type VoiceSample = {
  id: string;
  user_id: string;
  pessoa_id: string;
  meeting_id: string | null;
  letter: string | null;
  audio_clip_path: string | null;
  embedding: number[];
  soft_deleted_at: string | null;
  created_at: string;
};

// ─── meetingsFor ──────────────────────────────────────────────────────

export const meetingsFor = (userId: string) => ({
  list: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<Meeting>(
        `SELECT * FROM meetings ORDER BY recorded_at DESC NULLS LAST, created_at DESC LIMIT 100`,
      );
      return r.rows;
    }),

  byId: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Meeting>(`SELECT * FROM meetings WHERE id = $1`, [id]);
      return r.rows[0] ?? null;
    }),

  updateSpeakerLabels: (id: string, speakerLabels: Record<string, string>, speakerPessoas: Record<string, string>) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Meeting>(
        `UPDATE meetings SET speaker_labels = $2, speaker_pessoas = $3 WHERE id = $1 RETURNING *`,
        [id, JSON.stringify(speakerLabels), JSON.stringify(speakerPessoas)],
      );
      return r.rows[0] ?? null;
    }),
});

// ─── tarefasFor ───────────────────────────────────────────────────────

export const tarefasFor = (userId: string) => ({
  abertas: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<
        Tarefa & { meeting_recorded_at: string | null; meeting_summary: string | null }
      >(
        `SELECT t.*,
                to_char(m.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS meeting_recorded_at,
                m.summary AS meeting_summary
         FROM tarefas t
         LEFT JOIN meetings m ON m.id = t.meeting_id
         WHERE t.status IN ('aberta','em_andamento')
         ORDER BY (t.prazo IS NULL), t.prazo ASC, t.created_at DESC
         LIMIT 200`,
      );
      return r.rows;
    }),

  byId: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Tarefa>(`SELECT * FROM tarefas WHERE id = $1`, [id]);
      return r.rows[0] ?? null;
    }),

  update: (id: string, patch: Partial<Pick<Tarefa, "titulo" | "descricao" | "prazo" | "prioridade" | "status">>) =>
    withTenant(userId, async (db) => {
      // Constrói UPDATE dinâmico com keys do patch
      const fields = Object.keys(patch) as (keyof typeof patch)[];
      if (fields.length === 0) return null;
      const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
      const values = fields.map((f) => patch[f]);
      const r = await db.query<Tarefa>(
        `UPDATE tarefas SET ${sets} WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      return r.rows[0] ?? null;
    }),
});

// ─── pessoasFor ───────────────────────────────────────────────────────

export const pessoasFor = (userId: string) => ({
  list: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<Pessoa>(`SELECT * FROM pessoas ORDER BY nome ASC`);
      return r.rows;
    }),

  byId: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Pessoa>(`SELECT * FROM pessoas WHERE id = $1`, [id]);
      return r.rows[0] ?? null;
    }),

  create: (nome: string, aliases: string[] = []) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Pessoa>(
        `INSERT INTO pessoas (user_id, nome, aliases) VALUES ($1, $2, $3) RETURNING *`,
        [userId, nome, aliases],
      );
      return r.rows[0];
    }),

  upsertByName: (nome: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<Pessoa>(
        `INSERT INTO pessoas (user_id, nome) VALUES ($1, $2)
         ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now()
         RETURNING *`,
        [userId, nome],
      );
      return r.rows[0];
    }),
});

// ─── voiceSamplesFor ──────────────────────────────────────────────────

export const voiceSamplesFor = (userId: string) => ({
  byPessoa: (pessoaId: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<VoiceSample>(
        `SELECT * FROM voice_samples
         WHERE pessoa_id = $1 AND soft_deleted_at IS NULL
         ORDER BY created_at DESC`,
        [pessoaId],
      );
      return r.rows;
    }),

  softDelete: (id: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<VoiceSample>(
        `UPDATE voice_samples SET soft_deleted_at = now()
         WHERE id = $1 AND soft_deleted_at IS NULL
         RETURNING *`,
        [id],
      );
      return r.rows[0] ?? null;
    }),
});
```

- [ ] **Step 3: Verificar typecheck**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep "lib/queries" | head -10
```

Expected: nenhum erro.

- [ ] **Step 4: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/lib/queries.ts
git commit -m "feat(lib): queries.ts — helpers tipados por tabela (meetingsFor, etc)

Substitui o padrão 'query(sql)' direto pelo padrão 'meetingsFor(id).list()'.
RLS no Postgres filtra automaticamente — métodos não precisam de WHERE user_id.
Defesa em profundidade: helpers tornam esquecer user_id estruturalmente
impossível; RLS protege se alguém usar query() cru.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# FASE 3 — Auth flow básico (sessão manual + middleware + página pública)

> Esta fase coincide com o momento do deploy quando a migration roda. **Tem janela ruim:** entre `psql -f 0007...` (Task 1.5) e deploy desta fase, o frontend antigo (que já conecta como `app_tenant`) **não consegue ler** tabelas com RLS porque não seta `app.current_user_id`. **Faça 1.5 + 3.x + 4.x num único maintenance window contíguo.**

### Task 3.1 — Criar sessão manual no DB pra você

**Files:** nenhum (DDL ad-hoc)

> Pré-requisito: Task 1.5 já aplicada (Vitor existe como user).

- [ ] **Step 1: Criar sua sessão**

```bash
source /Users/vitorgambetti/AssistentePessoal/.env
VITOR_UUID=$(psql "$DATABASE_URL" -At -c "SELECT id FROM users WHERE is_admin AND deleted_at IS NULL LIMIT 1;")
SESSION_ID=$(psql "$DATABASE_URL" -At -c "INSERT INTO sessions (user_id, ip_address, user_agent) VALUES ('$VITOR_UUID', NULL, 'manual-init') RETURNING id;")
echo "Sua sessão: $SESSION_ID"
```

Anote `$SESSION_ID`. Vai precisar pra setar o cookie no browser.

- [ ] **Step 2: Setar o cookie no browser**

Abra o frontend `https://n8n-assistente-frontend.tatetz.easypanel.host/` no browser desktop. Devtools → Application → Cookies → site → criar cookie:
- Nome: `session`
- Valor: `<SESSION_ID>`
- Path: `/`
- HttpOnly: ON (se o devtools permitir; se não, Next.js vai aceitar mesmo sem)
- Secure: ON
- SameSite: Lax
- Expires: data + 30 dias

Salve. Antes do deploy do frontend novo (Task 4.x), o cookie fica inerte (nada lê) — mas estará pronto.

### Task 3.2 — Criar `frontend/middleware.ts` (Node runtime, valida sessão real)

**Files:**
- Create: `frontend/middleware.ts`

- [ ] **Step 1: Antes de codar, conferir o suporte a Node runtime em middleware no Next.js 16**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
ls node_modules/next/dist/docs/01-app/02-guides/ 2>&1 | grep -i auth
ls node_modules/next/dist/docs/01-app/01-getting-started/ 2>&1 | grep -i middlew
find node_modules/next/dist/docs -name "*middleware*" -type f 2>&1 | head -5
```

Abra o doc relevante e confirme se `runtime: 'nodejs'` é suportado em `middleware.ts`. Se NÃO for, ajustar a estratégia: usar middleware Edge só pra check de cookie presence + Server Component layout wrapper que valida sessão real chamando `requireUser()` via try/catch.

- [ ] **Step 2: Implementar middleware (Node runtime se suportado)**

Criar `frontend/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { query } from "./lib/db";

// Node runtime pra ter acesso ao pg (Edge runtime não tem)
export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon).*)"],
};

const PUBLIC_PREFIXES = [
  "/c/",
  "/sem-acesso",
  "/termos",
  "/api/save-audio",
  "/api/health",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionId = req.cookies.get("session")?.value;
  if (!sessionId) {
    return NextResponse.redirect(new URL("/sem-acesso", req.url));
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = await query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = $1
           AND s.revoked_at IS NULL
           AND s.last_used_at > $2
           AND u.deleted_at IS NULL
       ) AS exists`,
      [sessionId, cutoff],
    );
    if (!rows[0]?.exists) {
      const res = NextResponse.redirect(new URL("/sem-acesso", req.url));
      res.cookies.delete("session");
      return res;
    }
  } catch (err) {
    console.error("middleware: erro validando sessão", err);
    return NextResponse.redirect(new URL("/sem-acesso", req.url));
  }

  return NextResponse.next();
}
```

> Se Next.js 16 NÃO suportar `runtime: 'nodejs'` em middleware, substitua a estratégia: middleware Edge faz só `if (!cookie) redirect`, e cada Server Component começa com `try { const user = await requireUser(); } catch (AuthError) { redirect('/sem-acesso'); }`. O helper `requireUserOrRedirect()` em `lib/auth.ts` cobre isso — adicione:
>
> ```typescript
> import { redirect } from 'next/navigation';
> export async function requireUserOrRedirect(): Promise<User> {
>   try { return await requireUser(); }
>   catch { redirect('/sem-acesso'); }
> }
> ```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep middleware | head -5
```

Expected: nenhum erro.

- [ ] **Step 4: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/middleware.ts
git commit -m "feat(middleware): valida sessão real (Node runtime + pg)

Não confia só em cookie presence — vai no DB conferir que sessão existe,
não foi revogada, está dentro do TTL (30d) e user não foi soft-deleted.
Se cookie referencia sessão inválida, deleta cookie e redireciona.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.3 — Criar página pública `/sem-acesso`

**Files:**
- Create: `frontend/app/sem-acesso/page.tsx`

- [ ] **Step 1: Criar página**

```typescript
export const dynamic = "force-static";

export default function SemAcessoPage() {
  return (
    <div className="mx-auto max-w-md space-y-6 pt-20 text-center">
      <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
        Acesso restrito
      </p>
      <h1 className="font-display text-4xl leading-[1.05]">
        Você precisa de um{" "}
        <span className="italic font-[450] text-[color:var(--muted-strong)]">
          convite.
        </span>
      </h1>
      <p className="text-[14px] text-[color:var(--muted-strong)]">
        Esse assistente é por enquanto um beta fechado. Se o Vitor te enviou um
        link, abra ele aqui — você ficará logado nesse celular pelos próximos 30
        dias automaticamente.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verificar typecheck + build local**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep sem-acesso | head -5
```

Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/sem-acesso/page.tsx
git commit -m "feat(page): /sem-acesso pra usuários sem sessão

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# FASE 4 — Refator de páginas e routes existentes

> Cada página/route atual hoje faz `query(...)` direto. Vão passar a fazer `const user = await requireUser()` (ou `requireUserOrRedirect()` em Server Components) e usar os helpers `*For(user.id)`.

### Task 4.1 — Refatorar `app/page.tsx` (homepage)

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Adicionar requireUserOrRedirect helper em `lib/auth.ts`**

Editar `frontend/lib/auth.ts`, adicionar import no topo:

```typescript
import { redirect } from "next/navigation";
```

E adicionar função no fim do arquivo:

```typescript
/** Use em Server Components: catch AuthError e redirect pra /sem-acesso. */
export async function requireUserOrRedirect(): Promise<User> {
  try {
    return await requireUser();
  } catch {
    redirect("/sem-acesso");
  }
}
```

- [ ] **Step 2: Substituir `app/page.tsx`**

```typescript
import { requireUserOrRedirect } from "@/lib/auth";
import { tarefasFor } from "@/lib/queries";
import { type Tarefa } from "@/components/task-row";
import { TasksDashboard } from "@/components/tasks-dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUserOrRedirect();

  let tarefas: Tarefa[] = [];
  let dbError: string | null = null;
  try {
    tarefas = (await tarefasFor(user.id).abertas()) as unknown as Tarefa[];
  } catch (e: unknown) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  if (dbError) {
    return (
      <div className="rounded-2xl border border-[color:var(--urgent)]/30 bg-[color:var(--urgent-bg)] p-6">
        <h2 className="text-sm font-semibold text-[color:var(--urgent)]">
          Não consegui conectar no banco
        </h2>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-[color:var(--urgent)]/90">
          {dbError}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-7 sm:space-y-9">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
          Pendências
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05]">
          O que está{" "}
          <span className="italic font-[450] text-[color:var(--muted-strong)]">
            combinado.
          </span>
        </h1>
        <p className="text-[14px] text-[color:var(--muted-strong)] max-w-md">
          Tudo que apareceu nas suas reuniões e voice notes, capturado e
          organizado pra você não perder nada.
        </p>
      </header>

      <TasksDashboard tarefas={tarefas} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep -E "app/page|lib/auth" | head -10
```

Expected: sem erro novo.

- [ ] **Step 4: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/page.tsx frontend/lib/auth.ts
git commit -m "refactor(page): homepage usa requireUserOrRedirect + tarefasFor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.2 — Refatorar páginas `/reunioes`

**Files:**
- Modify: `frontend/app/reunioes/page.tsx`
- Modify: `frontend/app/reunioes/[id]/page.tsx`
- Modify: `frontend/app/reunioes/[id]/identificar/page.tsx`
- Modify: `frontend/app/reunioes/[id]/segmentar/page.tsx` **[+v2]**

- [ ] **Step 1: Ler as 3 páginas pra entender suas queries atuais**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
for f in app/reunioes/page.tsx app/reunioes/[id]/page.tsx app/reunioes/[id]/identificar/page.tsx; do
  echo "=== $f ==="; grep -n "query\|requireUser\|SELECT\|UPDATE\|INSERT" "$f"
done
```

- [ ] **Step 2: Em cada uma, adicionar no topo (após imports)**

```typescript
import { requireUserOrRedirect } from "@/lib/auth";
import { meetingsFor } from "@/lib/queries";

export const dynamic = "force-dynamic";
```

- [ ] **Step 3: No corpo da page (Server Component async)**

Adicionar como primeira linha do componente:

```typescript
const user = await requireUserOrRedirect();
```

E substituir `query<Meeting>(...)` calls por `meetingsFor(user.id).list()` / `.byId(id)` conforme o caso.

Se houver queries que `meetingsFor` ainda não cobre (ex: contagem agregada, joins específicos), **adicionar o método em `lib/queries.ts`** em vez de fazer query crua na página.

- [ ] **Step 4: Typecheck depois de cada arquivo modificado**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep "reunioes" | head -10
```

Expected: sem erros após cada arquivo.

- [ ] **Step 5: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/reunioes/ frontend/lib/queries.ts
git commit -m "refactor(reunioes): usa requireUserOrRedirect + meetingsFor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.3 — Refatorar páginas `/pessoas`

**Files:**
- Modify: `frontend/app/pessoas/page.tsx`
- Modify: `frontend/app/pessoas/[id]/page.tsx`

- [ ] **Step 1: Mesma rotina da Task 4.2 — ler, adicionar requireUserOrRedirect, trocar queries por `pessoasFor(user.id)` / `voiceSamplesFor(user.id)`**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
for f in app/pessoas/page.tsx app/pessoas/[id]/page.tsx; do
  echo "=== $f ==="; grep -n "query\|requireUser\|SELECT\|UPDATE" "$f"
done
```

Aplicar mesmo padrão. Adicionar métodos em `pessoasFor`/`voiceSamplesFor` se faltar.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep "pessoas" | head -10
```

- [ ] **Step 3: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/pessoas/ frontend/lib/queries.ts
git commit -m "refactor(pessoas): usa requireUserOrRedirect + pessoasFor/voiceSamplesFor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.4 — Refatorar Route Handlers existentes

**Files:**
- Modify: `frontend/app/api/meetings/[id]/identify/route.ts`
- Modify: `frontend/app/api/meetings/[id]/speakers/route.ts`
- Modify: `frontend/app/api/meetings/[id]/segments/route.ts` **[+v2: faz INSERT em meetings com `source='segmented'`; INSERTs precisam de `user_id` + helper `withTenant` ou propagação manual. Endpoint hoje usa `withClient` (transação manual) — vai precisar adaptar pra setar `SET LOCAL app.current_user_id` antes dos INSERTs/SELECTs]**
- Modify: `frontend/app/api/pessoas/route.ts`
- Modify: `frontend/app/api/pessoas/[id]/route.ts`
- Modify: `frontend/app/api/tarefas/[id]/route.ts`
- Modify: `frontend/app/api/samples/[id]/route.ts`
- Modify: `frontend/app/api/audio/[meetingId]/route.ts`
- Modify: `frontend/app/api/voice-svc/clip/route.ts`

> `/api/health`, `/api/save-audio`, `/api/voice-svc/health` são públicos (no PUBLIC_PREFIXES do middleware ou sem RLS) — **NÃO refatorar pra requireUser**.

- [ ] **Step 1: Em cada Route Handler, padrão**

Início de cada `export async function GET/POST/PATCH/DELETE`:

```typescript
import { requireUser, AuthError } from "@/lib/auth";
// ... outros imports

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) {
      return new Response("unauthorized", { status: e.status });
    }
    throw e;
  }
  const { id } = await params;

  // ... resto usa meetingsFor(user.id).byId(id) etc
}
```

Repetir pra cada handler em cada arquivo. Os Route Handlers que fazem proxy pro voice-svc (`/api/voice-svc/clip`, `/api/meetings/[id]/identify`) passam `user.id` no body do request pro voice-svc — não esquecer.

- [ ] **Step 2: O `/api/save-audio/route.ts` muda diferente — aceita `X-User-Id` header**

Esse endpoint é chamado pelo n8n (ingest) e futuramente pelo PWA. Adicionar:

```typescript
const userId = req.headers.get("x-user-id");
if (!userId) {
  return new Response("missing X-User-Id", { status: 400 });
}
```

E garantir que o INSERT em meetings inclui `user_id`. Como esse handler usa connection padrão (sem `withTenant`), use `query()` direto MAS passe `user_id` explícito no INSERT.

- [ ] **Step 3: Typecheck após cada arquivo**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep "api/" | head -20
```

- [ ] **Step 4: Build verifica (faz import resolution real)**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bun run build 2>&1 | tail -30
```

Expected: build completa sem erro. Warnings de "deprecated API" de Next.js 16 podem aparecer — ler o doc relevante em `node_modules/next/dist/docs/` se algum bloquear.

- [ ] **Step 5: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/api/ frontend/lib/queries.ts
git commit -m "refactor(api): Route Handlers usam requireUser + helpers tipados

save-audio aceita X-User-Id header (vem do n8n com fallback pro Vitor).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.5 — Adicionar `user-menu` no header (layout.tsx)

**Files:**
- Create: `frontend/components/user-menu.tsx`
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Criar componente**

`frontend/components/user-menu.tsx`:

```typescript
"use client";

import { useTransition } from "react";

export function UserMenu({ nome, isAdmin }: { nome: string; isAdmin: boolean }) {
  const [pending, start] = useTransition();

  const logout = () => {
    start(async () => {
      await fetch("/api/sessao", { method: "DELETE" });
      window.location.href = "/sem-acesso";
    });
  };

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-[color:var(--muted-strong)]">{nome}</span>
      {isAdmin && (
        <a href="/admin/convites" className="text-[color:var(--accent)] hover:underline">
          admin
        </a>
      )}
      <button
        onClick={logout}
        disabled={pending}
        className="text-[color:var(--muted)] hover:text-[color:var(--fg)] disabled:opacity-50"
      >
        {pending ? "..." : "sair"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Editar `app/layout.tsx` pra renderizar o user-menu**

Ler o arquivo atual primeiro:

```bash
cat /Users/vitorgambetti/AssistentePessoal/frontend/app/layout.tsx
```

Adicionar no topo:

```typescript
import { requireUser } from "@/lib/auth";
import { UserMenu } from "@/components/user-menu";
```

No componente raiz (RootLayout async), antes do `return`:

```typescript
let user = null;
try {
  user = await requireUser();
} catch {
  // não-logado vê layout sem menu (páginas públicas)
}
```

No header (procurar onde está o title / nav), adicionar:

```tsx
{user && <UserMenu nome={user.nome} isAdmin={user.is_admin} />}
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bun run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/components/user-menu.tsx frontend/app/layout.tsx
git commit -m "feat(ui): user-menu no header (nome + admin link + logout)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.6 — Deploy Fase 1 + Fase 3-4 num único maintenance window

> **Este passo executa o rollout zero-downtime real.** Tudo o que vem antes era preparação.

- [ ] **Step 1: Aplicar migration 0007 em prod** (referência Task 1.5)

- [ ] **Step 2: Garantir sessão manual existe** (Task 3.1)

- [ ] **Step 3: Build local pra ter certeza absoluta antes de deploy**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bun run build 2>&1 | tail -20
```

Expected: build sucesso.

- [ ] **Step 4: Deploy frontend (push pro easypanel)**

Como o projeto deploya: build na easypanel a partir do git push. Subir os commits acumulados:

```bash
cd /Users/vitorgambetti/AssistentePessoal
git push origin main
```

Aguarda o build no easypanel (UI). Logs em tempo real ajudam.

- [ ] **Step 5: Verificar que o frontend serve OK**

```bash
curl -s -I https://n8n-assistente-frontend.tatetz.easypanel.host/sem-acesso
```

Expected: HTTP 200.

- [ ] **Step 6: Abrir o frontend no browser**

Abrir `https://n8n-assistente-frontend.tatetz.easypanel.host/` no browser onde você setou o cookie na Task 3.1. Deve carregar com seu dashboard.

Se redirecionar pra `/sem-acesso`: o cookie está faltando ou inválido. Re-fazer Task 3.1.

Se mostrar erro de DB: o frontend tá conectando como app_tenant mas o `withTenant` não está rodando — checar logs. Provavelmente faltou refatorar alguma página/route.

- [ ] **Step 7: Verificação manual completa**

Navegar: `/`, `/reunioes`, `/reunioes/<algum-id-conhecido>`, `/pessoas`, `/pessoas/<id>`. Cada uma deve carregar e mostrar seus dados normais.

---

# FASE 5 — Auth flow completo (convites, admin, segurança)

### Task 5.1 — Página `/c/[code]` (consumir convite)

**Files:**
- Create: `frontend/app/c/[code]/page.tsx`

- [ ] **Step 1: Criar página com lookup de invite + form**

```typescript
import { query } from "@/lib/db";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Invite = {
  code: string;
  nome_sugerido: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

export default async function ConviteCodigoPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const rows = await query<Invite>(
    `SELECT code, nome_sugerido, consumed_at, revoked_at
       FROM invites WHERE code = $1`,
    [code],
  );
  const invite = rows[0];

  if (!invite || invite.consumed_at || invite.revoked_at) {
    return (
      <div className="mx-auto max-w-md pt-20 text-center space-y-4">
        <h1 className="font-display text-3xl">Esse convite não está mais válido.</h1>
        <p className="text-[color:var(--muted-strong)]">
          Pode ser que já foi usado, ou foi revogado. Fale com o Vitor pra pedir
          um novo.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md pt-20 space-y-6">
      <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
        Convite
      </p>
      <h1 className="font-display text-4xl">
        Bem-vindo,{" "}
        <span className="italic">{invite.nome_sugerido}.</span>
      </h1>
      <p className="text-[14px] text-[color:var(--muted-strong)]">
        Confirma seu nome abaixo. Você ficará logado nesse celular pelos próximos
        30 dias, sem precisar de senha.
      </p>
      <form action="/api/sessao" method="POST" className="space-y-4">
        <input type="hidden" name="code" value={invite.code} />
        <input
          name="nome"
          defaultValue={invite.nome_sugerido}
          required
          minLength={2}
          maxLength={80}
          className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-4 py-3 text-base"
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-[color:var(--fg)] text-[color:var(--bg)] py-3 font-medium"
        >
          Confirmar e entrar
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep "c/" | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/c/
git commit -m "feat(page): /c/[code] mostra convite e formulário de confirmação

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.2 — Route Handler `/api/sessao` (POST consume, DELETE logout)

**Files:**
- Create: `frontend/app/api/sessao/route.ts`

- [ ] **Step 1: Criar handler**

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  consumeInvite,
  destroySession,
  setSessionCookie,
  getCurrentSessionId,
  InviteError,
} from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`sessao:${ip}`, 5, 60_000)) {
    return new NextResponse("rate limit", { status: 429 });
  }

  // Aceita JSON ou form-encoded (form POST nativo)
  const contentType = req.headers.get("content-type") || "";
  let code: string | undefined;
  let nome: string | undefined;
  if (contentType.includes("application/json")) {
    const body = await req.json();
    code = body.code;
    nome = body.nome;
  } else {
    const form = await req.formData();
    code = form.get("code")?.toString();
    nome = form.get("nome")?.toString();
  }

  if (!code || !nome || nome.trim().length < 2) {
    return new NextResponse("invalid", { status: 400 });
  }

  try {
    const { sessionId } = await consumeInvite(
      code,
      nome.trim(),
      ip === "unknown" ? null : ip,
      req.headers.get("user-agent") || "",
    );
    await setSessionCookie(sessionId);
  } catch (e) {
    if (e instanceof InviteError) {
      return new NextResponse(e.message, { status: 409 });
    }
    throw e;
  }

  // redireciona pro app (ou pra /termos se ainda não aceitou)
  return NextResponse.redirect(new URL("/", req.url), 303);
}

export async function DELETE(req: NextRequest) {
  const sessionId = await getCurrentSessionId();
  if (sessionId) await destroySession(sessionId);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bunx tsc --noEmit 2>&1 | grep "api/sessao" | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/api/sessao/
git commit -m "feat(api): /api/sessao POST consume invite + DELETE logout (rate-limited)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.3 — Route Handler `/api/sessao/revoke-all`

**Files:**
- Create: `frontend/app/api/sessao/revoke-all/route.ts`

- [ ] **Step 1: Criar handler**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireUser, revokeAllSessions, AuthError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return new NextResponse(null, { status: e.status });
    throw e;
  }
  await revokeAllSessions(user.id);
  return NextResponse.redirect(new URL("/sem-acesso", req.url), 303);
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/api/sessao/revoke-all/
git commit -m "feat(api): /api/sessao/revoke-all (logout de todos os dispositivos)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.4 — Página `/seguranca/sessoes`

**Files:**
- Create: `frontend/app/seguranca/sessoes/page.tsx`

- [ ] **Step 1: Criar página**

```typescript
import { requireUserOrRedirect } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  created_at: string;
  last_used_at: string;
  ip_address: string | null;
  user_agent: string | null;
};

export default async function SessoesPage() {
  const user = await requireUserOrRedirect();
  const sessions = await query<SessionRow>(
    `SELECT id, created_at, last_used_at, ip_address::text, user_agent
       FROM sessions WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY last_used_at DESC`,
    [user.id],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-3xl">Sessões ativas</h1>
        <p className="text-[14px] text-[color:var(--muted-strong)]">
          Cada celular ou navegador onde você entrou aparece aqui.
        </p>
      </header>

      <ul className="space-y-3">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border border-[color:var(--border)] p-4 text-sm"
          >
            <div className="font-medium">{s.user_agent ?? "—"}</div>
            <div className="text-[color:var(--muted-strong)] text-xs">
              IP {s.ip_address ?? "?"} · último uso {new Date(s.last_used_at).toLocaleString("pt-BR")} · criada {new Date(s.created_at).toLocaleDateString("pt-BR")}
            </div>
          </li>
        ))}
      </ul>

      <form action="/api/sessao/revoke-all" method="POST">
        <button
          type="submit"
          className="rounded-lg border border-[color:var(--urgent)] text-[color:var(--urgent)] px-4 py-2 hover:bg-[color:var(--urgent-bg)]"
        >
          Sair de todos os dispositivos
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/seguranca/
git commit -m "feat(page): /seguranca/sessoes lista sessões + revoke-all

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.5 — Página `/termos` + lógica de redirect

**Files:**
- Create: `frontend/app/termos/page.tsx`
- Create: `frontend/app/termos/actions.ts`
- Modify: `frontend/middleware.ts` (adicionar redirect pra /termos se consent_terms_at IS NULL)

- [ ] **Step 1: Criar página `/termos`**

`frontend/app/termos/page.tsx`:

```typescript
import { aceitarTermos } from "./actions";
import { requireUserOrRedirect } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TermosPage() {
  const user = await requireUserOrRedirect();
  if (user.consent_terms_at) redirect("/");

  return (
    <div className="mx-auto max-w-2xl pt-12 space-y-6">
      <h1 className="font-display text-3xl">Antes de começar</h1>

      <div className="prose-sm space-y-4 text-[14px] text-[color:var(--muted-strong)]">
        <p>
          Esse assistente recebe áudios de reuniões e voice notes, transcreve
          via OpenAI Whisper e extrai ações pendentes via OpenAI GPT.
        </p>
        <p>
          <strong>Você é a pessoa responsável pelos áudios que envia.</strong>{" "}
          Se outras pessoas estão na gravação, garanta que elas consentiram em
          ter a fala delas transcrita e processada por IA.
        </p>
        <p>
          A gente armazena os áudios e transcrições enquanto a conta existe.
          Você pode pedir pra deletar tudo a qualquer momento (whatsapp pro
          Vitor).
        </p>
      </div>

      <form action={aceitarTermos}>
        <button
          type="submit"
          className="rounded-lg bg-[color:var(--fg)] text-[color:var(--bg)] px-6 py-3 font-medium"
        >
          Concordo e quero começar
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Criar Server Action `aceitarTermos`**

`frontend/app/termos/actions.ts`:

```typescript
"use server";

import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { redirect } from "next/navigation";

export async function aceitarTermos() {
  const user = await requireUser();
  await query(
    `UPDATE users SET consent_terms_at = now() WHERE id = $1 AND consent_terms_at IS NULL`,
    [user.id],
  );
  redirect("/");
}
```

- [ ] **Step 3: Atualizar middleware pra forçar redirect pra /termos**

Editar `frontend/middleware.ts`. Após validação de sessão, antes do `return NextResponse.next()`, adicionar:

```typescript
// Força aceite dos termos antes do app
if (pathname !== "/termos" && !pathname.startsWith("/api/sessao")) {
  const consentRows = await query<{ consent_terms_at: string | null }>(
    `SELECT u.consent_terms_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sessionId],
  );
  if (!consentRows[0]?.consent_terms_at) {
    return NextResponse.redirect(new URL("/termos", req.url));
  }
}
```

> Adiciona ~1 query SQL por request. Pode otimizar depois com cache ou JOIN no check de sessão. Por enquanto MVP.

- [ ] **Step 4: Typecheck + build**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bun run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/termos/ frontend/middleware.ts
git commit -m "feat(lgpd): /termos + redirect forçado no primeiro acesso

Estrutura LGPD: usuário aceita termos antes de poder usar o app.
Banner POR-GRAVAÇÃO (no momento de upload) vai no sub-projeto 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.6 — Admin (`/admin/layout` + `/admin/convites`)

**Files:**
- Create: `frontend/app/admin/layout.tsx`
- Create: `frontend/app/admin/convites/page.tsx`
- Create: `frontend/app/admin/convites/actions.ts`

- [ ] **Step 1: Layout admin**

`frontend/app/admin/layout.tsx`:

```typescript
import { requireUser, AuthError } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    const u = await requireUser();
    if (!u.is_admin) redirect("/");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sem-acesso");
    throw e;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <nav className="text-sm text-[color:var(--muted-strong)] space-x-4">
        <a href="/admin/convites" className="hover:text-[color:var(--fg)]">Convites</a>
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Server Actions `criarConvite` e `revogarConvite`**

`frontend/app/admin/convites/actions.ts`:

```typescript
"use server";

import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";

export async function criarConvite(formData: FormData) {
  const admin = await requireAdmin();
  const nome = formData.get("nome")?.toString().trim();
  if (!nome || nome.length < 2) return;

  const code = randomBytes(16).toString("base64url");
  await query(
    `INSERT INTO invites (code, nome_sugerido, created_by) VALUES ($1, $2, $3)`,
    [code, nome, admin.id],
  );
  await query(
    `INSERT INTO audit_log (user_id, action, target_id, metadata)
     VALUES ($1, 'invite.create', $2, $3)`,
    [admin.id, code, JSON.stringify({ nome_sugerido: nome })],
  );
  revalidatePath("/admin/convites");
}

export async function revogarConvite(formData: FormData) {
  const admin = await requireAdmin();
  const code = formData.get("code")?.toString();
  if (!code) return;

  await query(
    `UPDATE invites SET revoked_at = now() WHERE code = $1 AND revoked_at IS NULL AND consumed_at IS NULL`,
    [code],
  );
  await query(
    `INSERT INTO audit_log (user_id, action, target_id) VALUES ($1, 'invite.revoke', $2)`,
    [admin.id, code],
  );
  revalidatePath("/admin/convites");
}
```

- [ ] **Step 3: Página `/admin/convites`**

`frontend/app/admin/convites/page.tsx`:

```typescript
import { query } from "@/lib/db";
import { criarConvite, revogarConvite } from "./actions";

export const dynamic = "force-dynamic";

type InviteRow = {
  code: string;
  nome_sugerido: string;
  created_at: string;
  consumed_at: string | null;
  consumed_by_nome: string | null;
  revoked_at: string | null;
};

async function fetchInvites(): Promise<InviteRow[]> {
  return query<InviteRow>(
    `SELECT i.code, i.nome_sugerido,
            to_char(i.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
            to_char(i.consumed_at, 'YYYY-MM-DD HH24:MI') AS consumed_at,
            (SELECT u.nome FROM users u WHERE u.id = i.consumed_by) AS consumed_by_nome,
            to_char(i.revoked_at, 'YYYY-MM-DD HH24:MI') AS revoked_at
       FROM invites i
       ORDER BY i.created_at DESC
       LIMIT 100`,
  );
}

export default async function AdminConvitesPage() {
  const invites = await fetchInvites();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://app.example.com";

  const pendentes = invites.filter((i) => !i.consumed_at && !i.revoked_at);
  const usados = invites.filter((i) => i.consumed_at);
  const revogados = invites.filter((i) => i.revoked_at && !i.consumed_at);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl">Convites</h1>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--muted)]">Criar novo</h2>
        <form action={criarConvite} className="flex gap-2">
          <input
            name="nome"
            placeholder="Nome (ex: João)"
            required
            minLength={2}
            maxLength={80}
            className="flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-4 py-2"
          />
          <button className="rounded-lg bg-[color:var(--fg)] text-[color:var(--bg)] px-4 py-2">
            Gerar
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--muted)]">Pendentes ({pendentes.length})</h2>
        <ul className="space-y-2">
          {pendentes.map((i) => (
            <li key={i.code} className="rounded-lg border border-[color:var(--border)] p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{i.nome_sugerido}</div>
                  <div className="text-xs text-[color:var(--muted-strong)]">criado {i.created_at}</div>
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-[color:var(--bg-elev)] px-2 py-1 rounded">{base}/c/{i.code}</code>
                  <form action={revogarConvite}>
                    <input type="hidden" name="code" value={i.code} />
                    <button className="text-xs text-[color:var(--urgent)]">revogar</button>
                  </form>
                </div>
              </div>
            </li>
          ))}
          {pendentes.length === 0 && (
            <p className="text-sm text-[color:var(--muted-strong)]">Nenhum convite pendente.</p>
          )}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--muted)]">Usados ({usados.length})</h2>
        <ul className="space-y-2">
          {usados.map((i) => (
            <li key={i.code} className="rounded-lg border border-[color:var(--border)] p-3 text-sm">
              <div className="font-medium">{i.consumed_by_nome ?? i.nome_sugerido}</div>
              <div className="text-xs text-[color:var(--muted-strong)]">
                consumido {i.consumed_at} · convidado como &ldquo;{i.nome_sugerido}&rdquo;
              </div>
            </li>
          ))}
          {usados.length === 0 && (
            <p className="text-sm text-[color:var(--muted-strong)]">Nenhum convite usado ainda.</p>
          )}
        </ul>
      </section>

      {revogados.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--muted)]">Revogados ({revogados.length})</h2>
          <ul className="space-y-2 text-sm">
            {revogados.map((i) => (
              <li key={i.code} className="rounded-lg border border-[color:var(--border)] p-3 text-[color:var(--muted-strong)]">
                {i.nome_sugerido} · revogado em {i.revoked_at}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Adicionar `NEXT_PUBLIC_BASE_URL` no `.env.example`**

```bash
echo "" >> /Users/vitorgambetti/AssistentePessoal/.env.example
echo "# URL pública do frontend (usado em /admin/convites pra montar o link de convite)" >> /Users/vitorgambetti/AssistentePessoal/.env.example
echo "NEXT_PUBLIC_BASE_URL=https://n8n-assistente-frontend.tatetz.easypanel.host" >> /Users/vitorgambetti/AssistentePessoal/.env.example
```

Adicionar a mesma variável no easypanel UI do frontend.

- [ ] **Step 5: Typecheck + build**

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bun run build 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/admin/ .env.example
git commit -m "feat(admin): /admin/convites — criar/listar/revogar convites

requireAdmin no layout; Server Actions pra mutações; audit log em cada ação.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.7 — Deploy Fase 5 + teste end-to-end de convite

- [ ] **Step 1: Push + deploy easypanel**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git push origin main
```

Aguardar build no easypanel.

- [ ] **Step 2: Criar convite via UI**

Acesse `https://...easypanel.host/admin/convites` (logado como Vitor). Crie convite pra "Test Beta". Copie o link.

- [ ] **Step 3: Testar consumo em janela anônima**

Abra o link copiado em janela anônima. Deve mostrar "Bem-vindo, Test Beta" + form. Confirme.

Expected: redireciona pra `/termos`. Aceite. Redireciona pra `/` mostrando dashboard vazio.

- [ ] **Step 4: Testar isolamento**

Em uma aba janela anônima (Test Beta), confira `/reunioes` → 0 resultados. Na sua janela (Vitor), `/reunioes` → seu histórico completo.

- [ ] **Step 5: Testar revogar**

Em `/admin/convites`, crie novo convite "Outro Test". Antes de consumir, clique revogar. Tente abrir o link → "Esse convite não está mais válido."

- [ ] **Step 6: Testar rate limit**

```bash
for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code}\n" https://...easypanel.host/c/inexistente-$i
done
```

Expected: HTTP 200 nas primeiras 5, HTTP 429 depois (ou nos GETs da page; se rate limit só está no POST do /api/sessao, ajustar).

> Se rate limit não pegou os GETs, adicione `rateLimit(...)` no início de `app/c/[code]/page.tsx` (Server Component pode usar `headers()` pra pegar IP — função similar a `clientIp`).

- [ ] **Step 7: Testar logout-all**

Logue como Vitor em 2 browsers diferentes (use cookie manual em browser2). Em `/seguranca/sessoes`, clique "Sair de todos os dispositivos". Refresh no browser2 → redireciona pra `/sem-acesso`.

---

# FASE 6 — voice-svc + n8n + mac-agent

### Task 6.1 — Atualizar `voice-svc/db.py` pra aceitar user_id

**Files:**
- Modify: `voice-svc/db.py`

- [ ] **Step 1: Ler arquivo atual**

```bash
cat /Users/vitorgambetti/AssistentePessoal/voice-svc/db.py
```

- [ ] **Step 2: Modificar funções relevantes**

Em cada função que faz query em `voice_samples`, `meetings`, `pessoas`:
- Adicionar parâmetro `user_id: str`
- Incluir `WHERE user_id = %s AND ...` (psycopg3 usa `%s`) em todas as queries
- Em INSERTs, adicionar `user_id` na lista de colunas

Exemplo pra `search_top_k`:

```python
def search_top_k(embedding: list[float], user_id: str, k: int = 5):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, pessoa_id, embedding
                  FROM voice_samples
                 WHERE user_id = %s
                   AND soft_deleted_at IS NULL
                """,
                (user_id,),
            )
            rows = cur.fetchall()
    # ... resto do cálculo numpy
```

Pra `insert_sample`:

```python
def insert_sample(user_id: str, pessoa_id: str, meeting_id: str, letter: str,
                  audio_clip_path: str, embedding: list[float]):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO voice_samples
                  (user_id, pessoa_id, meeting_id, letter, audio_clip_path, embedding)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (user_id, pessoa_id, meeting_id, letter, audio_clip_path, embedding),
            )
            return cur.fetchone()[0]
```

> voice-svc usa role `app_writer` (BYPASSRLS) — não precisa de `SET app.current_user_id`. Mas DEVE passar `user_id` explícito em toda query escopada pra não vazar entre tenants.

- [ ] **Step 3: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add voice-svc/db.py
git commit -m "feat(voice-svc): db.py aceita user_id em todas queries escopadas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.2 — Atualizar `voice-svc/main.py` endpoints

**Files:**
- Modify: `voice-svc/main.py`

- [ ] **Step 1: Ler arquivo**

```bash
cat /Users/vitorgambetti/AssistentePessoal/voice-svc/main.py
```

- [ ] **Step 2: Pra cada endpoint escopado, adicionar `user_id` no Pydantic model do request**

Exemplo pra `/enroll`:

```python
class EnrollRequest(BaseModel):
    user_id: str
    meeting_id: str
    letter: str
    pessoa_id: str
    audio_url: str

@app.post("/enroll")
async def enroll(req: EnrollRequest):
    # ... usa req.user_id em todas as chamadas ao db
    sample_id = insert_sample(
        user_id=req.user_id,
        pessoa_id=req.pessoa_id,
        meeting_id=req.meeting_id,
        # ...
    )
    return {"sample_id": sample_id}
```

Pra `/identify`:

```python
class IdentifyRequest(BaseModel):
    user_id: str
    meeting_id: str
    speakers: list[dict]

@app.post("/identify")
async def identify(req: IdentifyRequest):
    # search_top_k recebe user_id pra filtrar base
    matches = []
    for speaker in req.speakers:
        embedding = compute_embedding(speaker)
        top = search_top_k(embedding, user_id=req.user_id, k=5)
        # ...
    return {"matches": matches}
```

Pra `DELETE /samples/{id}`:

```python
@app.delete("/samples/{sample_id}")
async def delete_sample(sample_id: str, user_id: str = Query(...)):
    # Confirma que sample pertence ao user antes de soft-delete
    # ...
```

- [ ] **Step 3: Build + deploy voice-svc**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add voice-svc/main.py
git commit -m "feat(voice-svc): endpoints aceitam user_id explícito

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

Build no easypanel via GHA (`.github/workflows/...` pre-build da imagem).

- [ ] **Step 4: Verificar voice-svc OK**

```bash
curl -s https://...easypanel.host/api/voice-svc/health
```

Expected: 200.

### Task 6.3 — Atualizar workflows n8n com `X-User-Id` + fallback

**[v2 nota:]** existem 2 workflows que tocam tabelas escopadas e precisam propagar `user_id`:
- `Acoes - Audio Ingest` (id `98jEiWWSAKFWEP6B`) — recebe áudio cru do mac-agent/PWA
- `Acoes - Process Segment` (id `Gt34r0WVdZxCbJet`) — recebe `{meeting_id}` dos filhos criados pelo endpoint `/api/meetings/[id]/segments` e extrai tarefas. Como o caller já está sob auth (Task 4.4 garante isso), ele deve incluir `user_id` no payload do POST pro webhook.

**Files:**
- Modify: `n8n-workflows/acoes-audio-ingest.json` (referência local)
- Modify: `n8n-workflows/acoes-process-segment.json` (referência local) **[+v2]**
- Modify: ambos workflows ao vivo no n8n (via curl)

- [ ] **Step 1: Atualizar arquivo local**

Editar `n8n-workflows/acoes-audio-ingest.json`, node `3. Prepare Metadata`. Substituir o jsCode pra ler `x-user-id`:

```javascript
const wh = $('1. Webhook').first();
const headers = wh.json.headers || {};
const filename = headers['x-original-filename'] || 'audio.mp3';
const ext = (filename.split('.').pop() || 'mp3').toLowerCase();

const userId = headers['x-user-id'] || $env.VITOR_FALLBACK_UUID;
if (!userId) throw new Error('X-User-Id ausente e VITOR_FALLBACK_UUID não configurado');

// ... resto do código original, adicionando user_id ao json retornado
return [{
  json: {
    user_id: userId,
    meeting_id,
    // ... outras props
  },
  binary: wh.binary
}];
```

E nos nodes `5. INSERT meeting` / `11. INSERT tarefas` / `7/12. UPDATE meeting`, adicionar `user_id` na cláusula INSERT/UPDATE/WHERE.

- [ ] **Step 2: Anotar o JSON atualizado e converter pra payload do n8n API**

```bash
cd /Users/vitorgambetti/AssistentePessoal
source .env
WORKFLOW_JSON=$(cat n8n-workflows/acoes-audio-ingest.json)
# ... convert para payload PUT
```

> n8n API espera o body com formato específico (geralmente `{nodes, connections, settings}`). Confirmar formato esperado:
> ```bash
> curl -s "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" -H "X-N8N-API-KEY: $N8N_API_KEY" | python3 -m json.tool | head -40
> ```

- [ ] **Step 3: Configurar `VITOR_FALLBACK_UUID` no n8n env**

Easypanel UI do n8n service → Environment → adicionar:
- Key: `VITOR_FALLBACK_UUID`
- Value: `<UUID anotado na Task 1.5>`

Reiniciar service.

- [ ] **Step 4: Push do workflow atualizado**

```bash
curl -s -X PUT "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  --data @n8n-workflows/acoes-audio-ingest.json
```

Expected: 200 + JSON do workflow atualizado.

- [ ] **Step 5: Reativar workflow se necessário**

```bash
curl -s -X PATCH "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": true}'
```

- [ ] **Step 6: Commit do arquivo local**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add n8n-workflows/acoes-audio-ingest.json
git commit -m "feat(n8n): workflow propaga X-User-Id em todos os INSERTs

Fallback pra VITOR_FALLBACK_UUID durante janela de rollout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.4 — Atualizar mac-agent

**Files:**
- Modify: `mac-agent/audio-watcher.sh`
- Modify: `.env.example`

- [ ] **Step 1: Adicionar `WEBHOOK_USER_ID` ao .env.example**

Editar `/Users/vitorgambetti/AssistentePessoal/.env.example`, adicionar (em algum lugar lógico, perto de WEBHOOK_URL):

```
# UUID do seu user (criado pela migration 0007). Encontra com:
#   psql "$DATABASE_URL" -c "SELECT id FROM users WHERE is_admin AND deleted_at IS NULL"
WEBHOOK_USER_ID=
```

- [ ] **Step 2: Editar audio-watcher.sh pra exigir + enviar o header**

Editar `mac-agent/audio-watcher.sh`. Após linha `: "${IPHONE_FOLDER:?...}"`, adicionar:

```bash
: "${WEBHOOK_USER_ID:?WEBHOOK_USER_ID não definida — veja .env.example}"
```

Na chamada `curl ... -X POST "$WEBHOOK_URL" ...`, adicionar:

```bash
  -H "X-User-Id: $WEBHOOK_USER_ID" \
```

- [ ] **Step 3: Atualizar `.env` real do mac-agent**

Editar `/Users/vitorgambetti/AssistentePessoal/.env` (não comitado). Adicionar:

```
WEBHOOK_USER_ID=<UUID do Vitor da Task 1.5>
```

- [ ] **Step 4: Recarregar launchd**

```bash
cd /Users/vitorgambetti/AssistentePessoal/mac-agent
launchctl unload ~/Library/LaunchAgents/com.vitor.assistente-pessoal.plist
launchctl load ~/Library/LaunchAgents/com.vitor.assistente-pessoal.plist
```

- [ ] **Step 5: Verificar logs**

```bash
tail -20 /Users/vitorgambetti/AssistentePessoal/mac-agent/watcher.log
```

Expected: linha "START watching ..." recente.

- [ ] **Step 6: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add mac-agent/audio-watcher.sh .env.example
git commit -m "feat(mac-agent): passa X-User-Id no webhook (preparação multi-tenant)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.5 — Atualizar Route Handler `/api/save-audio` pra aceitar X-User-Id

**Files:**
- Modify: `frontend/app/api/save-audio/route.ts`

- [ ] **Step 1: Ler arquivo atual**

```bash
cat /Users/vitorgambetti/AssistentePessoal/frontend/app/api/save-audio/route.ts
```

- [ ] **Step 2: Adicionar leitura do header + propagação**

```typescript
export async function POST(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return new Response("missing X-User-Id", { status: 400 });
  }

  // ... lógica existente
  // Quando fizer INSERT em meetings (se fizer), incluir user_id:
  await query(
    `INSERT INTO meetings (id, user_id, source, original_filename, audio_path, ...)
     VALUES ($1, $2, $3, $4, $5, ...)`,
    [meetingId, userId, ...],
  );
}
```

> Como esse endpoint usa role do app (app_tenant), e RLS está ativa em meetings, INSERT pode falhar sem `app.current_user_id` setado. **Decisão:** esse handler deve usar `withTenant(userId, ...)` pra setar a var antes do INSERT. Refatorar o INSERT pra usar withTenant.

- [ ] **Step 3: Deploy + verificar**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/app/api/save-audio/route.ts
git commit -m "feat(api): save-audio exige X-User-Id e propaga via withTenant

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

Aguardar deploy.

- [ ] **Step 4: Teste end-to-end com áudio**

Grave um áudio teste (qualquer .m4a curto) e coloque em `$MACBOOK_FOLDER`. Aguarde ~2 min.

Verificar:

```bash
source /Users/vitorgambetti/AssistentePessoal/.env
psql "$DATABASE_URL" -c "SELECT id, user_id, status FROM meetings ORDER BY created_at DESC LIMIT 3;"
```

Expected: último meeting tem `user_id = <Vitor UUID>` e status progride pra `done`.

---

# FASE 7 — Documentação + verificação final

### Task 7.1 — Atualizar `frontend/AGENTS.md` com regras de cache + auth

**Files:**
- Modify: `frontend/AGENTS.md`

- [ ] **Step 1: Ler arquivo atual + appendar**

```bash
cat /Users/vitorgambetti/AssistentePessoal/frontend/AGENTS.md
```

Acrescentar ao fim:

```markdown

# Multi-tenant cache safety

- Toda página/layout que chama `requireUser()` ou `requireUserOrRedirect()` DEVE ter `export const dynamic = 'force-dynamic'` no topo
- NÃO usar `fetch(..., { next: { revalidate } })` em rotas de dados de usuário — preferir query direta via helpers (`meetingsFor(user.id).list()` etc)
- Se precisar cachear, incluir `user.id` no key:
  ```typescript
  unstable_cache(fn, [user.id, 'meetings'], { tags: [`user:${user.id}:meetings`] })
  ```
- Em Server Components, use `requireUserOrRedirect()` (catch + redirect)
- Em Route Handlers e Server Actions, use `requireUser()` (catch AuthError pra retornar HTTP 4xx)
- Em `middleware.ts` (Node runtime), validação é feita inline com query direto — não usar requireUser lá (cookies async + Edge poderia)

# Helpers tipados por tabela

- TODA query de dados escopados passa por `lib/queries.ts` (meetingsFor, tarefasFor, pessoasFor, voiceSamplesFor)
- Sistema (sessions/invites/users/audit_log) usa `query()` direto de `lib/db.ts`
- Se precisa de uma query nova em tabela escopada, **adicione um método em queries.ts**, não escreva inline
```

- [ ] **Step 2: Commit**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/AGENTS.md
git commit -m "docs(frontend): regras de cache safety + helpers tipados pós-multitenant

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7.2 — Verificação end-to-end completa (15 checks do spec)

**Files:** nenhum (só verificação)

- [ ] **Step 1: DB sano**

```bash
psql "$DATABASE_URL" <<SQL
SELECT 'meetings' tabela, count(*) total, count(*) FILTER (WHERE user_id IS NULL) sem_user FROM meetings
UNION ALL SELECT 'tarefas', count(*), count(*) FILTER (WHERE user_id IS NULL) FROM tarefas
UNION ALL SELECT 'pessoas', count(*), count(*) FILTER (WHERE user_id IS NULL) FROM pessoas
UNION ALL SELECT 'voice_samples', count(*), count(*) FILTER (WHERE user_id IS NULL) FROM voice_samples;
SQL
```

Expected: `sem_user = 0` em todas.

- [ ] **Step 2: CHECK constraints validadas**

```bash
psql "$DATABASE_URL" -c "SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE '%_user_id_not_null';"
```

Expected: 4 linhas, `convalidated = t`.

- [ ] **Step 3: RLS habilitada**

```bash
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity ORDER BY tablename;"
```

Expected: meetings, pessoas, tarefa_eventos, tarefas, usage_events, voice_samples.

- [ ] **Step 4: Você vê tudo como antes**

Browser → login com cookie Vitor → `/`, `/reunioes`, `/pessoas`. Dados todos visíveis.

- [ ] **Step 5: Convite funciona** (já testado na Task 5.7)

- [ ] **Step 6: Isolamento aplicacional** (já testado na Task 5.7)

- [ ] **Step 7: Isolamento RLS direto**

```bash
source /Users/vitorgambetti/AssistentePessoal/.env
VITOR_UUID=$(psql "$DATABASE_URL" -At -c "SELECT id FROM users WHERE is_admin LIMIT 1;")
TEST_UUID=$(psql "$DATABASE_URL" -At -c "SELECT id FROM users WHERE NOT is_admin LIMIT 1;")
psql "$DATABASE_URL_TENANT" <<SQL
SET app.current_user_id = '$TEST_UUID';
SELECT count(*) FROM meetings;  -- esperado 0
SET app.current_user_id = '$VITOR_UUID';
SELECT count(*) FROM meetings;  -- esperado N (seu histórico)
SQL
```

- [ ] **Step 8: Race condition do invite**

Criar convite teste. Abrir o link em 2 abas anônimas (browser1+browser2) simultaneamente. Pressionar "Confirmar" quase simultaneamente.

Expected: exatamente 1 vê dashboard, outra vê erro "Invite inválido ou já consumido".

- [ ] **Step 9: Rate limit**

```bash
for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://...easypanel.host/api/sessao \
    -H "Content-Type: application/json" -d '{"code":"xyz","nome":"x"}'
done
```

Expected: 5 retornos não-429, depois 429.

- [ ] **Step 10: Pipeline existente — mac-agent**

Grave um áudio teste no `$MACBOOK_FOLDER`. Aguarde ~2 min.

```bash
psql "$DATABASE_URL" -c "SELECT id, user_id, status, original_filename FROM meetings ORDER BY created_at DESC LIMIT 3;"
```

Expected: último meeting com `user_id = vitor_id` e status final `done`. Aparece em `/reunioes` SEU. Test Beta vê 0 meetings.

- [ ] **Step 11: voice-svc isolation**

Via API direta (curl):

```bash
# Enroll user A (Vitor)
curl -X POST https://...easypanel.host/api/voice-svc/clip \
  -d '{"user_id": "'$VITOR_UUID'", "meeting_id": "...", ...}'

# Identify user B (Test Beta) — esperado: 0 matches
curl -X POST .../identify \
  -d '{"user_id": "'$TEST_UUID'", ...}'
```

Expected: matches = []

- [ ] **Step 12: Session TTL**

```bash
SESSION_ID=$(psql "$DATABASE_URL" -At -c "SELECT id FROM sessions WHERE user_id = '$VITOR_UUID' AND revoked_at IS NULL ORDER BY last_used_at DESC LIMIT 1;")
psql "$DATABASE_URL" -c "UPDATE sessions SET last_used_at = now() - interval '31 days' WHERE id = '$SESSION_ID';"
```

No browser, dar refresh. Expected: redireciona pra `/sem-acesso`.

> Depois, criar nova sessão manual pro Vitor pra continuar trabalhando.

- [ ] **Step 13: Logout all devices** (já testado na Task 5.7)

- [ ] **Step 14: Audit log populado**

```bash
psql "$DATABASE_URL" -c "SELECT action, count(*) FROM audit_log GROUP BY action ORDER BY count DESC;"
```

Expected: lista com pelo menos `invite.create`, `invite.consume`, `backfill.completed`.

- [ ] **Step 15: Termos LGPD**

Criar novo convite + consumir em janela anônima. Confirmar nome. Expected: redireciona pra `/termos`. Aceitar. Redireciona pra `/`.

Em `users`, conferir:

```bash
psql "$DATABASE_URL" -c "SELECT nome, consent_terms_at FROM users WHERE is_admin = FALSE ORDER BY created_at DESC LIMIT 3;"
```

Expected: `consent_terms_at` populado após aceite.

- [ ] **Step 16: Commit final do plano executado**

```bash
cd /Users/vitorgambetti/AssistentePessoal
git log --oneline -20
```

Expected: ver os ~20 commits dessa implementação. Tudo limpo.

---

## Não-tarefas (decisão consciente)

Por economia de escopo + decisão registrada no spec:

- Setup de vitest/jest no frontend (sem test runner — verificação manual)
- Setup de pytest no voice-svc (idem)
- Trigger Postgres "sempre 1 admin" (ON DELETE RESTRICT + soft delete já cobre indiretamente)
- Migration tool tipo Flyway (uma migration só nesse spec)
- aliases UNIQUE cross-row em pessoas
- Device fingerprinting em sessões
- Stripe billing automático (vai pro sub-projeto 4)
- Dashboard de uso `/admin/usuarios` (sub-projeto 4)

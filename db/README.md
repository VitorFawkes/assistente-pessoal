# db — schema Postgres

Sem migration tool automatizada. Cada `000X_*.sql` é idempotente (CREATE IF NOT
EXISTS / DROP IF EXISTS / ON CONFLICT) e aplicado em ordem manual via dbgate,
pgweb, `psql` ou endpoint temporário `/api/admin/sql`.

## Ordem de aplicação

| # | Arquivo | O que faz |
|---|---|---|
| 0001 | `0001_schema.sql` | Tabelas base: meetings, tarefas, tarefa_eventos + view v_tarefas_abertas |
| 0002 | `0002_segments.sql` | Adiciona `meetings.segments JSONB` (turnos diarizados) |
| 0003 | `0003_speaker_labels.sql` | Adiciona `meetings.speaker_labels JSONB` |
| 0004 | `0004_pessoas.sql` | Tabela pessoas (identidade estável speaker→pessoa) + `meetings.speaker_pessoas` |
| 0005 | `0005_voice_samples.sql` | Tabela voice_samples (embeddings ECAPA 192d em REAL[] — sem pgvector) |
| 0006 | `0006_meeting_segmentation.sql` | Fatiamento de áudio longo em N filhos (`parent_meeting_id`, `needs_segmentation`, status `archived_session`, source `segmented`) |
| **0007** | **`0007_multitenant.sql`** | **Multi-tenant: tabelas users/invites/sessions/audit_log/usage_events + user_id em meetings/tarefas/pessoas/voice_samples + RLS + índices compostos** |
| 0017 | `0017_meeting_sections.sql` | Adiciona `meetings.sections JSONB` (seções de assunto não-destrutivas) |

## Roles Postgres (pré-requisito da 0007)

A 0007 habilita RLS. Pra funcionar, o role de conexão **não pode** ter
BYPASSRLS. Crie 2 roles separados antes de aplicar:

```sql
-- Roda como SUPERUSER (role original do easypanel, tipicamente postgres):
CREATE ROLE app_tenant LOGIN PASSWORD '<senha-tenant>' NOBYPASSRLS;
CREATE ROLE app_writer LOGIN PASSWORD '<senha-writer>' BYPASSRLS;

GRANT CONNECT ON DATABASE <nome_do_db> TO app_tenant, app_writer;
GRANT USAGE ON SCHEMA public TO app_tenant, app_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant, app_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant, app_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant, app_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_tenant, app_writer;
```

Depois atualize os `DATABASE_URL` dos 3 services no easypanel UI:
- **Frontend** (`n8n_assistente-frontend`) → `app_tenant` (RLS ativo — `lib/db.ts:withTenant` faz `SET LOCAL app.current_user_id`)
- **n8n** → `app_writer` (BYPASSRLS — workflows propagam user_id explícito)
- **voice-svc** → `app_writer` (BYPASSRLS — funções em `voice-svc/db.py` propagam user_id explícito)

## Como aplicar a 0007

```bash
source .env

# 1) Backup obrigatório (operação irreversível)
pg_dump "$DATABASE_URL" > /tmp/backup-pre-0007-$(date +%Y%m%d-%H%M%S).sql

# 2) Apply
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -f db/0007_multitenant.sql

# 3) Verificações
psql "$DATABASE_URL" <<SQL
-- backfill saneado?
SELECT 'meetings' tabela, count(*) total, count(*) FILTER (WHERE user_id IS NULL) sem_user FROM meetings
UNION ALL SELECT 'tarefas', count(*), count(*) FILTER (WHERE user_id IS NULL) FROM tarefas
UNION ALL SELECT 'pessoas', count(*), count(*) FILTER (WHERE user_id IS NULL) FROM pessoas
UNION ALL SELECT 'voice_samples', count(*), count(*) FILTER (WHERE user_id IS NULL) FROM voice_samples;

-- CHECK constraints validadas?
SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE '%_user_id_not_null';

-- RLS habilitada?
SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity ORDER BY tablename;

-- UUID do user admin (Vitor) — anote pra usar em WEBHOOK_USER_ID + VITOR_FALLBACK_UUID
SELECT id FROM users WHERE is_admin AND deleted_at IS NULL;
SQL
```

## Rollback da 0007

Não há rollback automático. Pra reverter, restaure o backup do passo 1:

```bash
psql "$DATABASE_URL" <<SQL
-- drop tabelas novas
DROP TABLE IF EXISTS usage_events CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS invites CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- desabilita RLS
ALTER TABLE meetings       DISABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas        DISABLE ROW LEVEL SECURITY;
ALTER TABLE pessoas        DISABLE ROW LEVEL SECURITY;
ALTER TABLE voice_samples  DISABLE ROW LEVEL SECURITY;
ALTER TABLE tarefa_eventos DISABLE ROW LEVEL SECURITY;

-- drop check + coluna user_id
ALTER TABLE meetings       DROP CONSTRAINT IF EXISTS meetings_user_id_not_null;
ALTER TABLE tarefas        DROP CONSTRAINT IF EXISTS tarefas_user_id_not_null;
ALTER TABLE pessoas        DROP CONSTRAINT IF EXISTS pessoas_user_id_not_null;
ALTER TABLE voice_samples  DROP CONSTRAINT IF EXISTS voice_samples_user_id_not_null;
ALTER TABLE meetings       DROP COLUMN IF EXISTS user_id;
ALTER TABLE tarefas        DROP COLUMN IF EXISTS user_id;
ALTER TABLE pessoas        DROP COLUMN IF EXISTS user_id;
ALTER TABLE voice_samples  DROP COLUMN IF EXISTS user_id;

-- volta UNIQUE global em pessoas
ALTER TABLE pessoas DROP CONSTRAINT IF EXISTS pessoas_user_nome_key;
ALTER TABLE pessoas ADD CONSTRAINT pessoas_nome_key UNIQUE (nome);
SQL
```

E depois reverter DATABASE_URL dos services pro role original com BYPASSRLS.

## Spec / plano

- `docs/superpowers/specs/2026-05-21-foundation-multitenant-design.md`
- `docs/superpowers/plans/2026-05-21-foundation-multitenant.md`

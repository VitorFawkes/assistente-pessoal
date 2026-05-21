# Disponibilizar o Assistente Pessoal pra outras pessoas — Spec v2

> **v2 incorpora reviews críticos de DHH, patio11 (Patrick McKenzie), Lee Robinson, Lukas Fittl e Troy Hunt.** Mudanças relevantes vs v1 marcadas com **[v2]**.

## Context

Hoje o projeto é **single-user (Vitor)**: schema sem `user_id`, frontend protegido só por basic auth no proxy, mac-agent local detectando áudios, WhatsApp hardcoded pro número do Vitor. Os áudios vêm do Mac dele (fswatch) ou do iPhone via iCloud sync.

**Objetivo de produto:** abrir pra um **beta semi-aberto (50-200 pessoas convidadas)**, em que cada um:
- Grava ou faz upload de áudio pelo celular (PWA, sem instalar app de loja)
- Tem o próprio dashboard de reuniões/tarefas, isolado dos outros
- Opcionalmente recebe resumo no WhatsApp pessoal
- Custo de OpenAI fica com o Vitor, mas o sistema rastreia consumo por pessoa pra cobrança manual

**Resultado esperado:** pessoa abre um link de convite no celular, confirma o nome, "instala" o PWA, grava uma reunião, e em ~2 min vê as tarefas no dashboard dela — exatamente como acontece hoje pro Vitor.

Esse documento cobre o **primeiro de 6 sub-projetos**: a fundação multi-tenant. Sem ela, nada do resto funciona.

---

## Decomposição (visão geral — referência futura)

O esforço total é grande demais pra um spec só. Quebrado em:

| # | Sub-projeto | Por quê |
|---|---|---|
| **1** | **Foundation multi-tenant** ← este doc | Pré-requisito de tudo |
| 2 | Pipeline server-side (migrar `transcribe.sh` pra container) | PWA não tem onde transcrever sem isso |
| 3 | PWA de captura mobile | É o frontdoor pros novos usuários |
| 4 | Rastreamento de custos por usuário + alerta de overflow **[v2]** | Pra cobrar manualmente + evitar prejuízo se alguém deixa gravador ligado |
| 5 | WhatsApp opt-in (per-user) | Substitui número hardcoded |
| 6 | Onboarding (primeiro acesso, install prompt PWA, copy) | Polish |

Ordem natural: 1 → 2 → 3 → 4 → 5 → 6.

---

## Scope deste spec (sub-projeto 1)

**Inclui:**
- Schema multi-tenant com `user_id` em todas tabelas existentes
- Tabelas novas: `users`, `invites`, `sessions`, `audit_log`, `usage_events` (placeholder pro sub-projeto 4)
- **[v2]** RLS (Row Level Security) habilitado nas tabelas com `user_id` (defesa em profundidade)
- **[v2]** Soft delete em `users` (preserva auditoria; FKs ficam ON DELETE RESTRICT)
- Backfill: Vitor vira `user_id` único proprietário de tudo que existe hoje
- Auth por cookie + tabela `sessions` (roll-own simples, sem libs externas)
- **[v2]** Session TTL 30 dias + validação de `last_used_at` (rotation implícita) + tracking de `ip_address`+`user_agent` + suporte a "logout all devices"
- **[v2]** Helpers tipados por tabela (`meetingsFor(userId).list()` em vez de `forUser(id).query(sql)`) — torna esquecer `user_id` estruturalmente impossível
- **[v2]** Middleware em Node runtime que valida a sessão de fato (não só presença de cookie)
- **[v2]** Cache policy explícita (queries diretas via `pg`, `dynamic = 'force-dynamic'` obrigatório em pages com `requireUser()`)
- **[v2]** Rate limiting em `/c/[code]` (proteção brute-force/timing)
- **[v2]** Audit log de ações sensíveis (criar/consumir invite, login, mudar `is_admin`, revogar sessão)
- **[v2]** Banner de consentimento LGPD na hora de gravar/upload (responsabilidade compartilhada com o usuário)
- Páginas: `/c/[code]` (consumir convite), `/sem-acesso`, `/admin/convites`, `/seguranca/sessoes` (logout-all)
- n8n: workflow passa a propagar `X-User-Id` recebido no header em todos os INSERTs, com fallback pro UUID do Vitor durante rollout
- `voice-svc`: endpoints `/enroll`, `/identify`, `/samples/{id}` passam a aceitar `user_id` e filtrar busca por ele
- Mac-agent: passa `X-User-Id` do `.env` (UUID do Vitor)
- Rollout zero-downtime pro Vitor com **[v2]** `ALTER TABLE ADD CONSTRAINT CHECK NOT VALID + VALIDATE` em vez de `SET NOT NULL` (evita AccessExclusiveLock)

**Não inclui (vai pra subprojetos seguintes):**
- PWA, gravação web, upload UI (sub-projeto 3)
- Migração de `transcribe.sh` pra server (sub-projeto 2)
- População efetiva de `usage_events` + dashboard de custos por usuário + alertas de overflow (sub-projeto 4)
- WhatsApp opt-in per-user (sub-projeto 5)
- Onboarding/copy/install prompt PWA (sub-projeto 6)
- `/admin/usuarios` UI rica (placeholder simples vai no sub-projeto 4 junto com analytics de uso)
- Stripe/billing automático (cobrança manual via "linhinha de quanto cada um gastou" — sub-projeto 4 cria o relatório)
- Login Google/email/password (decisão original: convite link único cobre o caso)

---

## Decisões coletadas (do brainstorm + reviews)

| Tópico | Decisão | Razão |
|---|---|---|
| Audiência | Beta semi-aberto, 50-200 | Vitor já sabe o que quer construir; não precisa de discovery de produto |
| Captura mobile | PWA instalável (gravar in-browser + upload) | Sem instalar app de loja, mas com ícone próprio |
| WhatsApp | Opcional (default OFF), mantém sub-projeto 5 como planejado | Vitor aceita o risco operacional de Evolution shared instance |
| Custos OpenAI | Vitor banca + sistema rastreia gasto por usuário | Vitor cobra manualmente depois |
| Auth | Link único de convite, cookie persistente (TTL 30d com sliding) | Zero fricção, sem senha/email pra debugar; rotation evita cookie theft permanente |
| Backfill | Vitor = primeiro user, dados existentes atribuídos a ele | Preserva histórico |
| Isolamento **[v2]** | **RLS no Postgres + helpers tipados por tabela** | Resposta do Vitor: "melhor solução possível". Defesa em profundidade real: helpers estruturais impedem bugs de honest dev; RLS protege se alguém usar `query()` cru |
| Convite | Página `/admin/convites`, uso único, sem expiração | Vitor cria, copia link, manda no WhatsApp |
| Admin | Campo `is_admin BOOLEAN` no user (Vitor único admin no início) | Suficiente — sem RBAC complexo |
| Pessoas/voice_samples | Por usuário | "João" do Vitor ≠ "João" da Maria |
| Stack auth | Roll-own (sem NextAuth/Lucia/etc) | Combina com pg cru + Route Handlers que já é o padrão do projeto |
| Migration tool | Manual com `psql -f` (não Flyway/Alembic agora) **[v2 — decisão consciente]** | DHH sugeriu adotar Flyway; mantemos manual porque é UMA migration nova nesse spec, e o projeto não tem outra rodando. Se virar 5+ migrations rápidas, adotamos depois |
| LGPD | Modelo "usuário = data controller; sistema = processor" + banner de consentimento explícito **[v2]** | patio11+Troy: terceiros gravados na reunião não consentiram em ser processados por IA. Mitigação: forçar usuário a confirmar que tem consentimento antes de cada upload |

---

## Design

### 1. Schema (`db/0006_multitenant.sql`)

#### 1.1 Tabelas novas

```sql
-- ─── users: identidade ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT NOT NULL,                  -- pode repetir entre tenants, sem UNIQUE
  email        TEXT,                           -- opcional (futuro: notif por email)
  whatsapp     TEXT,                           -- opcional (sub-projeto 5)
  is_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ                     -- [v2] soft delete; queries filtram WHERE deleted_at IS NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active
  ON users(email) WHERE email IS NOT NULL AND deleted_at IS NULL;

-- Garante que existe sempre 1 admin ativo (impossibilita desabilitar você mesmo por engano)
-- (validação aplicacional via trigger fica como follow-up; ON DELETE RESTRICT já cobre)

-- ─── invites: links gerados pelo admin ────────────────────────────

CREATE TABLE IF NOT EXISTS invites (
  code           TEXT PRIMARY KEY,             -- randomBytes(16).toString('base64url')
  nome_sugerido  TEXT NOT NULL,                -- pra Vitor lembrar pra quem mandou
  created_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at    TIMESTAMPTZ,
  consumed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invites_unused
  ON invites(created_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- ─── sessions: cookie persistente [v2: TTL + tracking] ────────────

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address    INET,                          -- [v2] pra anomaly detection
  user_agent    TEXT,                          -- [v2] truncado em 500 chars na inserção
  revoked_at    TIMESTAMPTZ                    -- [v2] "logout all devices" marca todas
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions(user_id) WHERE revoked_at IS NULL;

-- ─── audit_log [v2] ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,  -- ator
  action      TEXT NOT NULL,        -- 'invite.create', 'invite.consume', 'invite.revoke',
                                    -- 'session.create', 'session.revoke_all',
                                    -- 'user.toggle_admin'
  target_id   TEXT,                 -- code do invite, id do user alvo, etc
  metadata    JSONB NOT NULL DEFAULT '{}',  -- { ip, user_agent, old_value, new_value }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_created
  ON audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_action_created
  ON audit_log(action, created_at DESC);

-- ─── usage_events: placeholder pro sub-projeto 4 ──────────────────

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
```

#### 1.2 ALTERs nas tabelas existentes

```sql
ALTER TABLE meetings       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE tarefas        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE pessoas        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE voice_samples  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
```

**[v2] Decisão de FK behavior**: `ON DELETE RESTRICT`. `DELETE FROM users` falha intencionalmente se houver dados associados. Uso esperado: soft delete via `users.deleted_at`. Auditoria preservada.

#### 1.3 Índices compostos (otimizados pro padrão de query real) **[v2]**

```sql
-- Substitui idx_meetings_status puro (mantém index_meetings_recorded pra ORDER BY global)
DROP INDEX IF EXISTS idx_meetings_status;
CREATE INDEX IF NOT EXISTS idx_meetings_user_status
  ON meetings(user_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_user_recorded
  ON meetings(user_id, recorded_at DESC);

DROP INDEX IF EXISTS idx_tarefas_status_abertas;
CREATE INDEX IF NOT EXISTS idx_tarefas_user_status_abertas
  ON tarefas(user_id, status)
  WHERE status NOT IN ('concluida','cancelada');

CREATE INDEX IF NOT EXISTS idx_tarefas_user_prazo
  ON tarefas(user_id, prazo)
  WHERE prazo IS NOT NULL AND status NOT IN ('concluida','cancelada');

CREATE INDEX IF NOT EXISTS idx_voice_samples_user_active
  ON voice_samples(user_id)
  WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pessoas_user
  ON pessoas(user_id);
```

#### 1.4 Pessoas: UNIQUE vira `(user_id, nome)`

```sql
ALTER TABLE pessoas DROP CONSTRAINT IF EXISTS pessoas_nome_key;
ALTER TABLE pessoas ADD CONSTRAINT pessoas_user_nome_key UNIQUE (user_id, nome);
```

`aliases TEXT[]` continua sem constraint cross-row (decisão consciente — overkill pro MVP; documentar como follow-up se virar problema).

#### 1.5 Backfill (transacionado)

```sql
-- ─── Backfill: dentro de transação implícita do DO block.
-- Se qualquer UPDATE falhar, tudo rollback (DDL Postgres atomic).
DO $$
DECLARE
  vitor_id UUID;
BEGIN
  -- cria user Vitor idempotentemente
  INSERT INTO users (nome, is_admin)
  SELECT 'Vitor', TRUE
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

  -- registra no audit log
  INSERT INTO audit_log (user_id, action, metadata)
  VALUES (vitor_id, 'backfill.completed',
          jsonb_build_object('migrated_at', now()));
END $$;
```

#### 1.6 NOT NULL via CHECK CONSTRAINT NOT VALID (lock fraco) **[v2]**

```sql
-- Lukas: SET NOT NULL adquire AccessExclusiveLock e escaneia tabela inteira.
-- ADD CONSTRAINT ... NOT VALID adquire só ShareUpdateExclusiveLock (permite SELECT/UPDATE simultâneos).
-- VALIDATE faz o scan com ShareLock (também permite leituras).

ALTER TABLE meetings      ADD CONSTRAINT meetings_user_id_not_null      CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE tarefas       ADD CONSTRAINT tarefas_user_id_not_null       CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE pessoas       ADD CONSTRAINT pessoas_user_id_not_null       CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE voice_samples ADD CONSTRAINT voice_samples_user_id_not_null CHECK (user_id IS NOT NULL) NOT VALID;

ALTER TABLE meetings      VALIDATE CONSTRAINT meetings_user_id_not_null;
ALTER TABLE tarefas       VALIDATE CONSTRAINT tarefas_user_id_not_null;
ALTER TABLE pessoas       VALIDATE CONSTRAINT pessoas_user_id_not_null;
ALTER TABLE voice_samples VALIDATE CONSTRAINT voice_samples_user_id_not_null;
```

#### 1.7 RLS (Row Level Security) **[v2 — adicionado por consenso DHH+Troy]**

```sql
-- Habilita RLS. Defaults a "deny all" — policies abrem o acesso explicitamente.
ALTER TABLE meetings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pessoas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_samples  ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefa_eventos ENABLE ROW LEVEL SECURITY;

-- Policy: usuário só vê linhas onde user_id = current_setting('app.current_user_id')
CREATE POLICY meetings_tenant ON meetings
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY tarefas_tenant ON tarefas
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY pessoas_tenant ON pessoas
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY voice_samples_tenant ON voice_samples
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY usage_events_tenant ON usage_events
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

-- tarefa_eventos: herda tenant via tarefa
CREATE POLICY tarefa_eventos_tenant ON tarefa_eventos
  FOR ALL
  USING (EXISTS (SELECT 1 FROM tarefas WHERE tarefas.id = tarefa_eventos.tarefa_id));

-- O usuário aplicacional do Postgres NÃO deve ter BYPASSRLS.
-- Confirmar com: SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname='<app_user>';
```

**Como a aplicação seta a variável:** `lib/db.ts` obtém uma conexão via `pg.Pool`, faz `SET LOCAL app.current_user_id = '<uuid>'` dentro de uma transação por request, depois roda as queries da request. `SET LOCAL` é escopado à transação (não vaza pra outras conexões do pool). Endpoints de sistema (sessions/invites lookup) não setam o var → RLS bloqueia tabelas com user_id, mas ainda podem ler tabelas sem RLS habilitada.

#### 1.8 View `v_tarefas_abertas`

Mantém sem filtro explícito de user_id — RLS garante isolamento mesmo se caller esquecer:

```sql
-- v_tarefas_abertas já existe; RLS via tarefas_tenant policy protege automaticamente
-- (recriação só pra documentar que ela continua válida)
CREATE OR REPLACE VIEW v_tarefas_abertas AS
SELECT t.*, m.recorded_at AS meeting_recorded_at, m.summary AS meeting_summary, m.meeting_type
FROM tarefas t
LEFT JOIN meetings m ON m.id = t.meeting_id
WHERE t.status IN ('aberta','em_andamento');
```

---

### 2. `frontend/lib/db.ts` (modificar)

```typescript
import { Pool, type PoolClient } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Query "sistema" — sem tenant scope. Usar APENAS pra sessions/invites/users.
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

// [v2] Query com tenant escope via RLS. SET LOCAL escopa o user_id à transação.
// Usado por TODOS endpoints/RSC que retornam dados de usuário.
export async function withTenant<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

### 3. `frontend/lib/queries.ts` (novo) — helpers tipados por tabela **[v2]**

Resposta ao C6: substitui o `forUser(id).query(sql)` com regex frágil por helpers estruturalmente tipados. **Impossível esquecer o filtro de user_id** porque o método já carrega o escope.

```typescript
import { withTenant } from './db';
import type { PoolClient } from 'pg';

export type Meeting = { id: string; user_id: string; status: string; /* ... */ };
export type Tarefa = { id: string; user_id: string; /* ... */ };

export const meetingsFor = (userId: string) => ({
  list: () => withTenant(userId, async (db) => {
    const r = await db.query<Meeting>(
      `SELECT * FROM meetings ORDER BY recorded_at DESC LIMIT 100`
    );
    return r.rows;
  }),
  byId: (id: string) => withTenant(userId, async (db) => {
    const r = await db.query<Meeting>(`SELECT * FROM meetings WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }),
  // ... etc
});

export const tarefasFor = (userId: string) => ({
  abertas: () => withTenant(userId, async (db) => {
    const r = await db.query<Tarefa>(
      `SELECT * FROM v_tarefas_abertas ORDER BY (prazo IS NULL), prazo ASC LIMIT 200`
    );
    return r.rows;
  }),
  // ...
});

// ... pessoasFor, voiceSamplesFor, etc
```

**Note:** as queries dentro de `withTenant` **não precisam** de `WHERE user_id = $1` — o RLS filtra automaticamente. Isso é a segunda camada de defesa: se alguém escrever `SELECT * FROM meetings` cru, ainda só retorna os do user atual (Postgres bloqueia).

### 4. `frontend/lib/auth.ts` (novo)

```typescript
import { cookies, headers } from 'next/headers';
import { query } from './db';
import { randomBytes } from 'crypto';

const COOKIE_NAME = 'session';
const SESSION_TTL_DAYS = 30;  // [v2] reduzido de 365
const SESSION_MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60;

export type User = {
  id: string; nome: string; email: string | null;
  is_admin: boolean; deleted_at: string | null;
};

export class AuthError extends Error {
  constructor(public status: 401 | 403) { super(`auth ${status}`); }
}

export async function requireUser(): Promise<User> {
  const sessionId = (await cookies()).get(COOKIE_NAME)?.value;
  if (!sessionId) throw new AuthError(401);

  // [v2] valida: existe + não revogada + last_used dentro do TTL
  const cutoff = new Date(Date.now() - SESSION_MAX_AGE * 1000).toISOString();
  const rows = await query<User>(`
    UPDATE sessions s SET last_used_at = now()
    WHERE s.id = $1 AND s.revoked_at IS NULL AND s.last_used_at > $2
    RETURNING (SELECT row_to_json(u) FROM users u WHERE u.id = s.user_id AND u.deleted_at IS NULL) AS user
  `, [sessionId, cutoff]);
  const user = rows[0]?.user as User | undefined;
  if (!user) throw new AuthError(401);
  return user;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (!u.is_admin) throw new AuthError(403);
  return u;
}

// [v2] Fix C1: claim atomic do invite via UPDATE com consumed_by já dentro.
// Se duas requisições concorrem, só uma vê RETURNING; a outra recebe vazio.
export async function consumeInvite(
  code: string, nome: string, ip: string, userAgent: string
): Promise<{ user: User; sessionId: string }> {
  // 1. cria user (separado pra ter o ID antes do claim — necessário pro RETURNING comparar)
  const userRows = await query<{ id: string }>(
    `INSERT INTO users (nome) VALUES ($1) RETURNING id`,
    [nome]
  );
  const newUserId = userRows[0].id;

  // 2. claim atomic do invite
  const claimRows = await query<{ consumed_by: string }>(`
    UPDATE invites
    SET consumed_at = now(), consumed_by = $2
    WHERE code = $1 AND consumed_at IS NULL AND revoked_at IS NULL
    RETURNING consumed_by
  `, [code, newUserId]);

  if (claimRows.length === 0 || claimRows[0].consumed_by !== newUserId) {
    // Perdeu a corrida (ou invite inválido/revogado) — remove o user criado.
    await query(`DELETE FROM users WHERE id = $1`, [newUserId]);
    throw new InviteError('Invite inválido ou já consumido');
  }

  // 3. cria sessão
  const sessionRows = await query<{ id: string }>(`
    INSERT INTO sessions (user_id, ip_address, user_agent)
    VALUES ($1, $2, $3) RETURNING id
  `, [newUserId, ip, (userAgent || '').slice(0, 500)]);
  const sessionId = sessionRows[0].id;

  // 4. audit
  await query(
    `INSERT INTO audit_log (user_id, action, target_id, metadata)
     VALUES ($1, 'invite.consume', $2, $3)`,
    [newUserId, code, JSON.stringify({ ip, user_agent: userAgent })]
  );

  // 5. busca user completo
  const userFullRows = await query<User>(
    `SELECT id, nome, email, is_admin, deleted_at FROM users WHERE id = $1`,
    [newUserId]
  );

  return { user: userFullRows[0], sessionId };
}

export async function setSessionCookie(sessionId: string) {
  (await cookies()).set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(sessionId: string) {
  await query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
  (await cookies()).delete(COOKIE_NAME);
}

// [v2] Logout all devices
export async function revokeAllSessions(userId: string) {
  await query(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  await query(
    `INSERT INTO audit_log (user_id, action, metadata) VALUES ($1, 'session.revoke_all', '{}'::jsonb)`,
    [userId]
  );
}

export class InviteError extends Error {}
```

### 5. `frontend/middleware.ts` (Node runtime) **[v2]**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { query } from './lib/db';

// [v2] Node runtime pra ter acesso ao pg
export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon).*)'],
};

const PUBLIC_PREFIXES = [
  '/c/', '/sem-acesso', '/api/save-audio', '/api/health',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionId = req.cookies.get('session')?.value;
  if (!sessionId) {
    return NextResponse.redirect(new URL('/sem-acesso', req.url));
  }

  // [v2] valida sessão de fato (não só presença do cookie)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await query<{ exists: boolean }>(`
    SELECT EXISTS(
      SELECT 1 FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.last_used_at > $2
        AND u.deleted_at IS NULL
    ) AS exists
  `, [sessionId, cutoff]);

  if (!rows[0]?.exists) {
    const res = NextResponse.redirect(new URL('/sem-acesso', req.url));
    res.cookies.delete('session');
    return res;
  }

  return NextResponse.next();
}
```

> **Nota Next.js 16:** confirmar suporte a `runtime: 'nodejs'` em middleware lendo `node_modules/next/dist/docs/01-app/02-guides/authentication.md` ou docs equivalentes ANTES de codar. Se Next.js 16 mudou o contrato, ajustar (alternativa: validar via Route Handler `/api/auth/check` chamado por wrapper layout).

### 6. Cache policy explícita **[v2]**

Em `frontend/AGENTS.md`, adicionar seção:

```markdown
## Multi-tenant cache safety

- Toda página que chama `requireUser()` DEVE ter `export const dynamic = 'force-dynamic'`
- NÃO usar `fetch(..., { next: { revalidate } })` em rotas de dados de usuário — preferir query direta via `meetingsFor(user.id).list()` etc
- Se precisar de cache, incluir `user.id` no key (`unstable_cache(fn, [user.id, 'meetings'], { tags: [`user:${user.id}:meetings`] })`)
```

### 7. Páginas e rotas **[v2: revisado]**

| Rota | Tipo | Função |
|---|---|---|
| `/c/[code]` | Server Component | Mostra "Você é o [nome]?" + form |
| `/c/[code]` POST handler | **Route Handler em `/api/sessao`** (não Server Action — escolha consciente pra ter erro HTTP explícito e ser testável) | Consome invite, cria user+session, redireciona |
| `/sem-acesso` | Server Component público | "Você precisa de um convite. Fale com o Vitor." |
| `/admin/layout.tsx` | Layout | `await requireAdmin()` no início |
| `/admin/convites` | Server Component | Lista pendentes + revogados + consumidos; form pra criar |
| `/admin/convites/actions.ts` | Server Actions | `criarConvite(nome)`, `revogarConvite(code)` (mutações simples) |
| `/seguranca/sessoes` **[v2]** | Server Component | Lista sessões ativas (data, IP, UA truncado) + botão "Sair de todos os dispositivos" |
| `/api/sessao` | Route Handler | POST = consumir invite (body: `{code, nome}`); DELETE = logout |
| `/api/sessao/revoke-all` | Route Handler | POST = revoga todas sessões do user |

### 8. Rate limiting em `/c/[code]` **[v2]**

Sem lib externa nova: helper simples in-memory por IP (suficiente pra single-instance, que é o atual).

```typescript
// lib/rate-limit.ts
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, maxRequests = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter(t => t > now - windowMs);
  if (arr.length >= maxRequests) return false;
  arr.push(now);
  buckets.set(key, arr);
  return true;
}
```

Aplicado em `/c/[code]` GET e `/api/sessao` POST, chaveado por IP. Excedido → HTTP 429.

> **Limitação consciente:** in-memory não escala pra múltiplas réplicas. Se virar problema, migra pra Postgres-backed (tabela `rate_limit_buckets`) ou Redis.

### 9. LGPD: banner de consentimento **[v2]**

Pro **sub-projeto 1**, scope limitado: criar a **estrutura de aviso**, sem ainda renderizar (o upload UI vem no sub-projeto 3). Decisões aqui:

- Coluna `users.consent_terms_at TIMESTAMPTZ` (NULL = ainda não aceitou termos)
- Página `/termos` (Server Component público): texto curto explicando "Você é o data controller. Sistema processa via OpenAI. Garanta consentimento dos participantes."
- No primeiro acesso pós-consumo de invite, redireciona pra `/termos` se `consent_terms_at IS NULL`. Botão "Aceito" → atualiza coluna → libera o resto do app.

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_terms_at TIMESTAMPTZ;
-- Backfill: Vitor já aceitou (você sabe o que tá fazendo)
UPDATE users SET consent_terms_at = now() WHERE is_admin = TRUE;
```

Banner de consentimento POR GRAVAÇÃO (checkbox "todos os participantes consentem") vai no sub-projeto 3, onde a UI de upload existe.

### 10. Integração com n8n

**Princípio:** o workflow n8n não sabe sobre auth/sessão; ele recebe `X-User-Id` no header e propaga em todos os INSERTs.

**[v2] Fallback explícito no rollout:** workflow step 3 (Prepare Metadata):

```javascript
const userId = headers['x-user-id'] || process.env.VITOR_FALLBACK_UUID;
if (!userId) throw new Error('X-User-Id ausente e fallback não configurado');
```

Variável `VITOR_FALLBACK_UUID` configurada no n8n env durante a janela de rollout (steps 5-7), removida após step 8.

Mudanças no workflow `Acoes - Audio Ingest` (id `98jEiWWSAKFWEP6B`):
- **Node 3 (Prepare Metadata)**: lê `x-user-id` com fallback acima
- **Node 5 (INSERT meeting)** e **Node 11 (INSERT tarefas)**: incluem `user_id` na lista de colunas
- **Node 7/12 (UPDATE meeting)**: `WHERE id = $1 AND user_id = $2`
- **n8n connection role**: pode precisar BYPASSRLS ou rodar com `SET app.current_user_id` na conexão. **Decisão:** n8n usa role com BYPASSRLS (writer privilegiado, confiável). Aplicação Next.js usa role SEM BYPASSRLS.

Atualização aplicada via curl com `N8N_API_KEY` (regra do projeto: nunca usar MCP n8n).

### 11. Mac-agent

`mac-agent/audio-watcher.sh` ganha:
```bash
: "${WEBHOOK_USER_ID:?WEBHOOK_USER_ID não definida — copie .env.example}"
curl ... -H "X-User-Id: $WEBHOOK_USER_ID" ...
```

`.env.example` ganha:
```
# UUID do seu user após apply de db/0006_multitenant.sql
# Buscar com: psql "$DATABASE_URL" -c "SELECT id FROM users WHERE is_admin AND deleted_at IS NULL"
WEBHOOK_USER_ID=
```

### 12. voice-svc

`voice-svc/main.py` endpoints aceitam `user_id`:
- `POST /enroll` body: `{ user_id, meeting_id, letter, pessoa_id, audio_url }`
- `POST /identify` body: `{ user_id, meeting_id, speakers: [...] }`
- `DELETE /samples/{id}?user_id=...` (autorização: sample.user_id == request user_id)
- `PATCH /samples/{id}?user_id=...`

`voice-svc/db.py`:
- `search_top_k(embedding, user_id, k=5)` adiciona `WHERE user_id = %s AND soft_deleted_at IS NULL`
- `insert_sample(...)` ganha `user_id` obrigatório
- Roda com role SEM RLS bypass (passa `SET LOCAL app.current_user_id` antes de cada operação que toca tabelas escopadas, igual frontend)

---

## Arquivos criados / modificados

**Criados** (15):
- `db/0006_multitenant.sql`
- `frontend/lib/auth.ts`
- `frontend/lib/queries.ts` **[v2 — substitui forUser]**
- `frontend/lib/rate-limit.ts` **[v2]**
- `frontend/middleware.ts` (Node runtime)
- `frontend/app/c/[code]/page.tsx`
- `frontend/app/sem-acesso/page.tsx`
- `frontend/app/termos/page.tsx` **[v2]**
- `frontend/app/admin/layout.tsx`
- `frontend/app/admin/convites/page.tsx`
- `frontend/app/admin/convites/actions.ts`
- `frontend/app/seguranca/sessoes/page.tsx` **[v2]**
- `frontend/app/api/sessao/route.ts`
- `frontend/app/api/sessao/revoke-all/route.ts` **[v2]**
- `frontend/components/user-menu.tsx` (avatar + logout no header)

**Modificados** (~15):
- `frontend/lib/db.ts` (adiciona `withTenant`)
- `frontend/app/layout.tsx` (header com user-menu + link admin se admin)
- `frontend/app/page.tsx` (usa `tarefasFor`)
- `frontend/app/reunioes/page.tsx` + `[id]/*.tsx`
- `frontend/app/pessoas/page.tsx` + `[id]/*.tsx`
- `frontend/app/api/meetings/[id]/*/route.ts`
- `frontend/app/api/pessoas/*/route.ts`
- `frontend/app/api/tarefas/*/route.ts`
- `frontend/app/api/samples/*/route.ts`
- `frontend/app/api/save-audio/route.ts` (aceita `X-User-Id`)
- `frontend/AGENTS.md` (seção "Multi-tenant cache safety" + regra "Cookies & Auth")
- `voice-svc/db.py` (RLS-aware queries)
- `voice-svc/main.py` (endpoints aceitam user_id)
- `mac-agent/audio-watcher.sh`
- `.env.example`
- `n8n-workflows/acoes-audio-ingest.json` + atualização via curl

---

## Rollout (zero-downtime pro Vitor) **[v2 — sequência revisada]**

Cada passo = commit + deploy independente. Rollback de 1 passo se algo quebrar.

**Pré-requisito de infra: roles Postgres separados**

Hoje todos os serviços (frontend, n8n, voice-svc) conectam via mesmo `DATABASE_URL` (provavelmente role default `postgres`, que tem `SUPERUSER` e **bypassa RLS automaticamente**). Pra RLS funcionar, precisa de roles separados:

```sql
-- Roda no Postgres (uma vez, antes do passo 1):
CREATE ROLE app_tenant LOGIN PASSWORD '<senha>' NOBYPASSRLS;
CREATE ROLE app_writer LOGIN PASSWORD '<senha>' BYPASSRLS;  -- n8n + voice-svc

GRANT CONNECT ON DATABASE <nome> TO app_tenant, app_writer;
GRANT USAGE ON SCHEMA public TO app_tenant, app_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant, app_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant, app_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant, app_writer;
```

Frontend usa `app_tenant` (RLS ativo). n8n e voice-svc usam `app_writer` (bypass — eles propagam `user_id` explícito vindo do header). Atualizar 3 `DATABASE_URL`s nos `.env` correspondentes.

**Sequência dos passos:**

1. **Cria roles `app_tenant` e `app_writer`** (SQL acima). Atualiza `DATABASE_URL` do frontend pra `app_tenant`, do n8n e voice-svc pra `app_writer`. Deploy. App continua funcionando (sem RLS ainda).
2. **Apply `0006_multitenant.sql`** — backfill garante seus dados ficam atribuídos a você. RLS é habilitada mas as queries do frontend atual ainda não setam `app.current_user_id` → **frontend quebra leitura das tabelas com RLS**. Janela ruim mas curta: passos 1-2 + 3-4 fazem juntos no mesmo deploy.
3. **Deploy frontend novo** com `lib/db.ts` (`withTenant`) + `lib/queries.ts` + `lib/auth.ts` + Route Handlers refatorados + páginas refatoradas + middleware Node runtime. **Antes do deploy:** cria sua sessão manual via `psql` (`INSERT INTO sessions (user_id, ip_address, user_agent) VALUES ('<seu uuid>', NULL, 'manual') RETURNING id`) e seta cookie `session=<id>` no browser via devtools. Após deploy, você abre o app → funciona via `withTenant` → RLS filtra (você é único user, vê tudo).
4. **Deploy `voice-svc` atualizado** (aceita `user_id` opcional com fallback pro vitor_uuid; role `app_writer` ignora RLS).
5. **Configura n8n com `VITOR_FALLBACK_UUID`** + atualiza workflow pra passar `X-User-Id` (com fallback). Update `mac-agent/.env` com `WEBHOOK_USER_ID`. Grava um áudio teste → aparece SÓ no seu dashboard com `user_id` correto.
6. **Confirma backfill 100% saneado:** `SELECT count(*) FROM meetings WHERE user_id IS NULL` em todas tabelas → 0.
7. **Deploy `/admin/convites`** (UI de criar/listar convites).
8. **Convida 1ª pessoa de confiança** (teste end-to-end).

**Rollback de qualquer passo:** revert do commit + redeploy. Schema é incremental e idempotente (todas as ALTERs/CREATEs com `IF NOT EXISTS`/`IF EXISTS`).

---

## Verificação end-to-end

1. **DB sano**: `SELECT count(*) FROM meetings WHERE user_id IS NULL` → 0 (idem outras tabelas com `user_id`).
2. **NOT NULL via CHECK validado**: `SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE '%_user_id_not_null'` → todas `t`.
3. **RLS habilitado**: `SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity` → meetings, tarefas, pessoas, voice_samples, usage_events, tarefa_eventos listadas.
4. **Você (admin) vê tudo como antes**: login com cookie, `/`, `/reunioes`, `/pessoas` mostram os mesmos dados que mostravam pré-migração.
5. **Convite funciona**: cria "Test Beta" em `/admin/convites`, copia link, abre em janela anônima → tela "Você é Test Beta?" → confirma → vê dashboard vazio.
6. **Isolamento aplicacional**: logado como Test Beta, `/reunioes` → 0 resultados. Logado como Vitor, `/reunioes` → seu histórico.
7. **Isolamento RLS direto** (teste manual no psql): `psql` conectado como role app, `SET app.current_user_id = '<test_beta_uuid>'`, `SELECT count(*) FROM meetings` → só os do Test Beta (0). `SET app.current_user_id = '<vitor_uuid>'` → seus N meetings.
8. **Race condition do invite**: abre o mesmo link de convite em 2 abas anônimas simultaneamente, confirma quase ao mesmo tempo → exatamente uma vê dashboard, outra vê erro "Invite inválido".
9. **Rate limit**: tenta abrir `/c/codigo-inexistente` 10× em 60s do mesmo IP → 6ª request retorna HTTP 429.
10. **Pipeline existente**: mac-agent processa um áudio novo → `meetings` ganha 1 linha com `user_id = vitor_id`. Aparece no seu dashboard, NÃO no do Test Beta.
11. **voice-svc isolation**: enroll com `user_id=A`, identify com `user_id=B` → não retorna match.
12. **Session TTL**: em DB, `UPDATE sessions SET last_used_at = now() - interval '31 days' WHERE id = <sua>` → próxima request → redireciona pra `/sem-acesso`.
13. **Logout all devices**: cria 2 sessões pro mesmo user (cookie em 2 browsers), `POST /api/sessao/revoke-all` em um → outro também perde acesso na próxima request.
14. **Audit log populado**: `SELECT action, count(*) FROM audit_log GROUP BY action` → vê eventos `invite.create`, `invite.consume`, `session.revoke_all`.
15. **Termos LGPD**: novo user (Test Beta) sem `consent_terms_at` → redirect pra `/termos` no primeiro acesso. Após aceitar → libera resto.

---

## Não-decisões deste spec (ficam pra subprojetos)

- Como o áudio chega via web (gravação MediaRecorder, upload, formato suportado) — **sub-projeto 3**
- Como `transcribe.sh` migra pro server — **sub-projeto 2**
- Schema e UI de billing/usage_events + alertas de overflow + dashboard de custos — **sub-projeto 4**
- WhatsApp opt-in per-user — **sub-projeto 5**
- Banner de consentimento POR-GRAVAÇÃO (checkbox antes do upload) — **sub-projeto 3** (já existe a estrutura de `consent_terms_at` aqui)
- Copy/onboarding/install prompt PWA — **sub-projeto 6**
- Migração pra ferramenta de migrations (Flyway/Alembic) — adiado: só vale a pena se virar 5+ migrations em sequência
- Trigger pra garantir "sempre 1 admin ativo" — follow-up; por enquanto `ON DELETE RESTRICT` + soft delete cobre indiretamente

---

## Issues levantadas pelos especialistas que ficam como follow-up consciente

- **DHH**: "use Migration tool agora". Adiado — só uma migration aqui; revisamos se virar 5+ rápidas.
- **DHH**: "corte `/admin/usuarios`". Cortado do scope deste sub-projeto (não está em "criados"); reentra no sub-projeto 4 com analytics.
- **Lukas**: "aliases UNIQUE cross-row". Adiado — overkill pro MVP.
- **Lukas**: "sessions bloat com UPDATE last_used_at por request". Aceito — VACUUM default cuida. Monitorar `n_dead_tup` no `pg_stat_user_tables`.
- **Troy**: "device fingerprinting". Não implementado — tradeoff privacy/utilidade não vale pra beta.
- **patio11**: "closed beta de 5 antes de 50". Vitor decidiu manter 50-200.
- **patio11**: "cobrança manual quebra entre 50-100". Riscos aceitos; reavaliar quando virar problema (mover pra Stripe é sub-projeto futuro).
- **patio11**: "WhatsApp Evolution multi-tenant = risco Meta ban". Vitor aceita o risco; tem plano B se acontecer.

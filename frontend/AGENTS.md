<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

**Sabidas no Next.js 16:**
- `middleware.ts` → `proxy.ts` (renomeado, roda em Node.js runtime por padrão; sem precisar de `export const runtime = 'nodejs'`)
- `cookies()` é async — `(await cookies()).get(...)`
- Server Components com `cookies()` exigem `export const dynamic = 'force-dynamic'`
<!-- END:nextjs-agent-rules -->

# Multi-tenant: regras críticas

Esse projeto agora é multi-tenant (Foundation = `db/0007_multitenant.sql` + `lib/auth.ts` + `lib/queries.ts` + RLS no Postgres). **Antes de tocar qualquer arquivo**, leia:

- `docs/superpowers/specs/2026-05-21-foundation-multitenant-design.md` (decisões)
- `docs/superpowers/plans/2026-05-21-foundation-multitenant.md` (execução)

## Onde resolver auth

| Lugar | Helper | Quando |
|---|---|---|
| Server Component (page) | `await requireUserOrRedirect()` | Catch automático: redireciona pra `/sem-acesso` |
| Route Handler | `withAuth(async (user, req, ctx) => {...})` | Retorna 401/403 automático |
| Server Action | `await requireUser()` (ou `requireAdmin()`) | Throw AuthError → Next.js converte em error UI |
| Admin-only | `withAuth(fn, { admin: true })` ou `requireAdmin()` | 403 se não é admin |

## Onde resolver dados escopados

- **Toda query de dados de usuário** (meetings, tarefas, pessoas, voice_samples, tarefa_eventos, usage_events) → use helpers de `lib/queries.ts` (`meetingsFor`, `tarefasFor`, `pessoasFor`, `voiceSamplesFor`)
- **Queries ad-hoc** que não cabem nos helpers → `withTenant(user.id, async (db) => { ... })` de `lib/db.ts`. Dentro do `withTenant`, queries NÃO precisam de `WHERE user_id` porque RLS no Postgres filtra automaticamente
- **Queries "de sistema"** (sessions, invites, users, audit_log) → `query()` direto de `lib/db.ts` (RLS não cobre essas tabelas — elas são lookup de auth)
- **NUNCA** usar `query()` direto pra ler/escrever em meetings/tarefas/pessoas/voice_samples. Se precisa, adicione método em `lib/queries.ts`

## Multi-tenant cache safety

- Toda página/layout que chama `requireUser()` ou `requireUserOrRedirect()` DEVE ter `export const dynamic = 'force-dynamic'` no topo
- NÃO usar `fetch(..., { next: { revalidate } })` em rotas de dados de usuário — preferir query direta via helpers (`meetingsFor(user.id).list()` etc). Fetch cacheado por URL pode vazar entre tenants se userId não estiver na URL
- Se precisar cachear, incluir `user.id` no key:
  ```typescript
  unstable_cache(fn, [user.id, 'meetings'], { tags: [`user:${user.id}:meetings`] })
  ```

## Pessoas

- `UNIQUE (user_id, nome)` (não mais UNIQUE global). `ON CONFLICT (user_id, nome) DO UPDATE` sempre com user_id explícito no INSERT
- "Vitor" não é mais especial globalmente — `is_vitor` agora é por-user (cada user tem seu próprio "eu")

## Workflows n8n e voice-svc

- n8n e voice-svc usam role `app_writer` (BYPASSRLS) — propagam `user_id` explícito no INSERT/SELECT
- Frontend usa role `app_tenant` (NOBYPASSRLS) — `withTenant()` seta `app.current_user_id` por transação
- Endpoint público `/api/save-audio` exige header `X-User-Id` (validado como UUID). n8n propaga vindo do mac-agent/PWA
- Endpoint `/api/meetings/[id]/identify` e `/speakers` propagam `user_id` no body pro voice-svc

## Padrões a EVITAR

- ❌ `await query("SELECT * FROM meetings WHERE id = $1", [id])` em Server Component / Route Handler
- ❌ `await query("UPDATE meetings ...")` sem `WHERE user_id`
- ❌ `INSERT INTO pessoas (nome) VALUES (...)` sem `user_id`
- ❌ `requireUser()` direto em Server Component (vai virar 500, não 401) — use `requireUserOrRedirect`
- ❌ Esquecer `dynamic = 'force-dynamic'` em página que lê cookies/sessão

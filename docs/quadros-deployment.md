# Quadros Compartilhados — Checklist de Deploy

> **Data de conclusão:** 2026-06-29  
> **Status:** Pronto para deploy  
> **Fases:** 1 (Edição Inline) ✓ | 2 (Schema + Dono) ✓ | 3 (Convidado Público) ✓ | 4 (Polish Visual + Robustez) ✓

---

## 1. Database — Migrations e Schema

### Aplicar migration 0019

A migration cria as tabelas de quadros, valida RLS e função SECURITY DEFINER.

```bash
# Em produção (se aplicável):
psql "$DATABASE_URL" -f db/0019_quadros.sql
```

**Verifications:**
- [ ] Tabelas criadas: `quadros`, `quadro_tarefas`, `quadro_convidados`
- [ ] RLS habilitado em todas as tabelas
- [ ] Função SECURITY DEFINER `resolver_quadro_token` existe
- [ ] Coluna `tarefa_eventos.quadro_convidado_id` existe e permite NULL
- [ ] Grants: `app_tenant` e `app_writer` têm acesso a tabelas e função

**SQL Verification Commands:**
```sql
-- Verificar tabelas
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'quadro%';

-- Verificar RLS em quadros
SELECT tablename FROM pg_tables WHERE tablename='quadros' AND schemaname='public';
SELECT policyname FROM pg_policies WHERE tablename='quadros';

-- Verificar coluna em tarefa_eventos
SELECT column_name FROM information_schema.columns WHERE table_name='tarefa_eventos' AND column_name='quadro_convidado_id';
```

---

## 2. Frontend — Build e Testes

### Build sem erros

```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend
bun run build
```

**Expected output:** `✓ Compiled successfully` (zero errors)

**Verifications:**
- [ ] Build completa sem erros de TypeScript
- [ ] Routes incluem:
  - `/q/[token]` — página pública do convidado
  - `/quadros` — lista de quadros do dono
  - `/quadros/[id]` — gerenciador de um quadro
  - `/api/q/[token]/tarefas` — APIs públicas
  - `/api/quadros/[id]/convidados` — gerenciamento de convidados

### Testes sem falhas

```bash
bun test
```

**Expected output:** `92 pass, 0 fail`

**Verifications:**
- [ ] Testes de `rate-limit` passam (30 req/min por token:ip)
- [ ] Testes de `GuestError` passam (rate_limit, invalid_token)
- [ ] Testes de `membershipDoQuadro` passam
- [ ] Nenhum warning de TypeScript em componentes quadros

### Componentes Principais

**Verifications:**
- [ ] `components/activity-feed.tsx` — timeline de eventos auditados
- [ ] `components/guest-board.tsx` — UI do quadro para convidado
- [ ] `components/guest-board-error.tsx` — estados vazios/erro amigáveis
- [ ] `components/quadro-manager.tsx` — gerenciador para dono
- [ ] `components/copy-link-button.tsx` — copiar link com feedback visual (2s "Copiado!")
- [ ] `lib/quadros.ts` — helpers de CRUD + `.atividade()`
- [ ] `lib/quadro-guest.ts` — `withGuest()` + `membershipDoQuadro()`
- [ ] `lib/task-mutations.tsx` — contexto TaskMutations com OwnerTaskProvider + GuestTaskProvider

### Toaster do Sonner

**Verifications:**
- [ ] `app/layout.tsx` contém `<Toaster />` do sonner
- [ ] Toasts aparecem em: criar convidado, copiar link, atualizar quadro, erros de taxa

---

## 3. Segurança — Autenticação, Autorização e Auditoria

### Rate-Limiting

**Convidado (público):**
- [ ] `/api/q/[token]/*` — 30 req/min por `token:ip`
- [ ] Resposta 429 ao exceder: `{ error: "rate_limit_exceeded", message: "Muitas requisições. Aguarde 1 minuto." }`
- [ ] Header `Retry-After: 60` incluído

**Dono (autenticado):**
- [ ] `/api/quadros/*` — 100 req/min por `user_id:ip` (opcional)
- [ ] Implementado via `rateLimit(key, max, windowMs)` em handlers

**Teste Manual:**
```bash
# Simular 31 requisições em 60s pra um token
for i in {1..31}; do
  curl -s "http://localhost:3000/api/q/[TOKEN]/tarefas" | jq -r '.error'
done
# Esperado: 30× "null" (ou sem erro), 31ª × "rate_limit_exceeded"
```

### Token — Segurança Criptográfica

**Verifications:**
- [ ] Tokens gerados via `randomBytes(16).toString("base64url")` — 128 bits (criptograficamente seguro)
- [ ] Tokens armazenados como `TEXT UNIQUE` em `quadro_convidados.token`
- [ ] Resolver via função SECURITY DEFINER `resolver_quadro_token(p_token TEXT)`
- [ ] Tokens nunca expostos em GET `/api/quadros/[id]/convidados` (apenas ID + nome)

### RLS — Confinamento de Tenant

**Verifications:**
- [ ] `quadros` — `USING (user_id::text = current_setting('app.current_user_id', true))`
- [ ] `quadro_tarefas` — Herda RLS via FK to quadros
- [ ] `quadro_convidados` — Herda RLS via FK to quadros
- [ ] Dono NÃO consegue ver/editar quadros de outro tenant
- [ ] Convidado NUNCA consegue acessar tarefas fora do seu quadro (validação via `membershipDoQuadro`)

**Teste Manual:**
```bash
# Como user1, tentar revogar convidado de quadro de user2 (falha esperada)
curl -X DELETE "http://localhost:3000/api/quadros/[USER2_QUADRO_ID]/convidados/[CONVIDADO_ID]" \
  -H "Cookie: session=[USER1_SESSION]" 
# Esperado: 401 ou 403
```

### Auditoria — Eventos com Atribuição de Convidado

**Verifications:**
- [ ] Cada mutação por convidado cria evento em `tarefa_eventos` com:
  - `evento` — 'criada' | 'editada' | 'cancelada' | 'deletada'
  - `quadro_convidado_id` — ID do convidado (NOT NULL quando via guest)
  - `payload` — JSON com mudanças (ex: `{"origem": "convidado", "mudancas": {...}}`)
  - `created_at` — timestamp
- [ ] Feed em `/quadros/[id]` mostra nome do convidado ("João editou Tarefa X, há 2 horas")
- [ ] Dono vê auditoria completa

**Teste Manual:**
```bash
# Criar tarefa como convidado
curl -X POST "http://localhost:3000/api/q/[TOKEN]/tarefas" \
  -H "Content-Type: application/json" \
  -d '{"titulo": "Nova Tarefa"}'

# Verificar evento (via query no DB)
SELECT evento, quadro_convidado_id, payload FROM tarefa_eventos 
WHERE evento = 'criada' AND quadro_convidado_id IS NOT NULL 
ORDER BY created_at DESC LIMIT 1;
# Esperado: evento='criada', quadro_convidado_id NOT NULL
```

### Revogação — Invalidação Imediata de Token

**Verifications:**
- [ ] DELETE `/api/quadros/[id]/convidados/[gid]` → UPDATE `revoked_at = now()`
- [ ] `resolver_quadro_token` filtra `WHERE revoked_at IS NULL`
- [ ] Convidado revogado recebe 401 em requisição seguinte
- [ ] Log em `tarefa_eventos` registra revogação (opcional mas recomendado)

**Teste Manual:**
```bash
# 1. Criar convidado, copiar token
# 2. Em outra aba, acessar /q/[TOKEN] → sucesso
# 3. Revogar convidado em /quadros/[id]
# 4. Na aba anterior, atualizar ou fazer ação → 401 "Link inválido ou revogado"
```

### Validação de Membership

**Verifications:**
- [ ] PATCH/DELETE `/api/q/[token]/tarefas/[id]` valida `membershipDoQuadro(c, quadroId, tarefaId)`
- [ ] Se falso: retorna 404 "Tarefa não está neste quadro"
- [ ] Impede acesso lateral (convidado1 não consegue editar tarefa de convidado2)

**Teste Manual:**
```bash
# Criar quadro1 com tarefa T1, quadro2 com tarefa T2
# Gerar token1 para quadro1
# Como convidado1, tentar PATCH /api/q/[token1]/tarefas/[T2_ID]
# Esperado: 404 "Tarefa não está neste quadro"
```

---

## 4. URLs Públicas — Configuração de Proxy/Router

### Proxy.ts — PUBLIC_PREFIXES

**Verifications:**
- [ ] `proxy.ts` contém `/q/` em `PUBLIC_PREFIXES`
- [ ] `/api/q/` está em PUBLIC_PREFIXES
- [ ] Ambas acessíveis sem autenticação

```typescript
// frontend/proxy.ts (ou middleware)
const PUBLIC_PREFIXES = [
  '/c/',
  '/q/',             // ← novo
  '/api/q/',         // ← novo
  '/api/capturar',
  // ...
];
```

### Páginas Públicas

**Verifications:**
- [ ] `/q/[token]` renderiza sem login (SPA minimalista)
- [ ] Layout: sem nav/sidebar, apenas header do quadro + tarefas + composer
- [ ] Responsivo: 375px (mobile) a 1920px (desktop)

**Teste Manual:**
```bash
# Em incógnito, abrir /q/[VALID_TOKEN]
# Esperado: vê nome do quadro, "Você está como [Nome]", tarefas, composer
# Sem: nav, sidebar, footer de autenticação
```

### Páginas Autenticadas

**Verifications:**
- [ ] `/quadros` — requer login, lista quadros
- [ ] `/quadros/[id]` — requer login, gerenciador
- [ ] `/quadros/[id]` → link "Quadros" em nav principal
- [ ] Toasts e erros funcionam

**Teste Manual:**
```bash
# Sem login, acessar /quadros → redireciona pra /sem-acesso ou login
# Com login, acessar /quadros → lista aparece
```

---

## 5. Testes de Aceitação Completos

### Fluxo Dono

1. **Criar quadro:**
   - [ ] GET /quadros → vê lista (vazia se novo)
   - [ ] Clica "+ Novo Quadro"
   - [ ] Preenche nome (ex: "Q1") + descrição (opcional)
   - [ ] Clica "Criar"
   - [ ] Vê "Quadro criado" (toast) + redireciona pra /quadros/[id]

2. **Gerenciar convidados:**
   - [ ] Vê seção "Convidados" (vazia)
   - [ ] Preenche "Nome do novo convidado" (ex: "João")
   - [ ] Clica "Criar"
   - [ ] Vê "Convidado criado" (toast)
   - [ ] Cartão com nome + botão "Copiar link"
   - [ ] Clica "Copiar link" → 2s "Copiado!" (ícone check, fundo verde)
   - [ ] Botão volta ao estado normal

3. **Atividade:**
   - [ ] Seção "Atividade" mostra eventos recentes
   - [ ] Avatar com primeira letra do nome
   - [ ] "João criou 'Tarefa X', há 5 minutos"
   - [ ] Link clicável pra tarefa
   - [ ] Scroll se muitos eventos (max-h-96)

### Fluxo Convidado

1. **Acessar página pública:**
   - [ ] Via link /q/[TOKEN] em incógnito
   - [ ] Vê "Nome do Quadro" (font-display, grande)
   - [ ] Subtítulo "Você está como João"
   - [ ] Lista de tarefas (se houver)
   - [ ] Composer "Criar nova tarefa"

2. **Editar/criar tarefa:**
   - [ ] Clica card → expande inline (Task 1)
   - [ ] Edita título → blur → salva (toast "Tarefa atualizada")
   - [ ] No composer, escreve algo + Enter → cria nova (toast "Tarefa criada")
   - [ ] Nova aparece na lista

3. **Estados de erro:**
   - [ ] Link inválido → GuestBoardError "Link não está mais válido"
   - [ ] Quadro vazio → GuestBoardError "Nenhuma tarefa neste quadro" (composer ainda visível)
   - [ ] Revogado (após revogar) → 401 → "Link não está mais válido"
   - [ ] Rate-limit (31ª req) → 429 + toast "Muitas tentativas"

4. **Responsive:**
   - [ ] 375px: titulo ≤ 3xl, padding 1rem, botão 100% width, readable
   - [ ] 768px: titulo 4xl, padding 1.5rem, layout OK
   - [ ] 1920px: max-w-2xl centered, espaçamento generoso

### Validações de Segurança

- [ ] **Confinamento:** Convidado1 tenta PATCH `/api/q/[token1]/tarefas/[tarefa_fora_quadro]` → 404
- [ ] **Revogação:** Revogar → próxima ação do convidado → 401
- [ ] **Rate-limit:** 31ª req em 60s → 429
- [ ] **Auditoria:** Ação do convidado → `quadro_convidado_id` preenchido em `tarefa_eventos`

---

## 6. Pós-Deploy — Verificação em Produção

### Logs e Monitoring

- [ ] Monitorar `/api/q/[token]/tarefas` pra 401 spurious (pode indicar revogação)
- [ ] Monitorar 429 — se frequente, aumentar limit pra 60 req/min
- [ ] Alertar pra errors 500 em handlers `/api/q/`
- [ ] Verificar auditoria: `SELECT COUNT(*) FROM tarefa_eventos WHERE quadro_convidado_id IS NOT NULL` crescendo

### Backup e Rollback

- [ ] Backup manual de `quadro_convidados`, `quadro_tarefas` antes de remover dados de teste
- [ ] Se erro crítico: rollback da migration 0019 (atenção: remove dados)

### Documentação de Usuário

- [ ] How-to: "Criar um quadro"
- [ ] How-to: "Convidar pessoas via link"
- [ ] How-to: "Revogar acesso"
- [ ] FAQ: "Posso criar quantos quadros?"
- [ ] FAQ: "O que acontece se revogar um convidado?"

---

## 7. Arquitetura — Resumo de Implementação

### Fases Completadas

| Fase | Descrição | Status |
|------|-----------|--------|
| 1 | Edição Inline + TaskMutationContext | ✓ DONE |
| 2 | Schema + Helpers + APIs do Dono | ✓ DONE |
| 3 | Acesso Público por Token + Confinamento | ✓ DONE |
| 4 | Polish Visual + Feed de Atividade + Validação | ✓ DONE |

### Key Features

- **Edição Inline:** Expand-in-place em cards (sem modal), salvamento otimista por campo
- **Convidados:** Links únicos por pessoa, validação de membership, rate-limit por token:ip
- **Auditoria:** Eventos em `tarefa_eventos` com `quadro_convidado_id`, feed visual com nomes
- **UI:** Design tokens (--calm, --warm, --urgent), Fraunces display em títulos, responsivo 375px–1920px
- **Security:** RLS, SECURITY DEFINER, rate-limit, revogação imediata

### Tecnologia

- **Frontend:** Next.js 16, React 19, Tailwind 4, Sonner (toasts)
- **Backend:** Node.js, PostgreSQL 14+, pg driver
- **Auth:** Multi-tenant via RLS + `app.current_user_id` setting
- **Testing:** Bun test, 92 suites passing

---

## Checklist Final

- [ ] Migration 0019 aplicada a produção
- [ ] Build `bun run build` ✓ (zero errors)
- [ ] Tests `bun test` ✓ (92 pass)
- [ ] Deploy frontend ao vivo
- [ ] Teste E2E: dono cria quadro + convidado acessa + edita
- [ ] Verificação de logs (sem 500s)
- [ ] Documentação de usuário pronta
- [ ] Go/No-go aprovado

---

## Rollback Plan (Se Necessário)

Se problema crítico pós-deploy:

1. Revert frontend (último commit antes de quadros)
2. Desabilitar rotas públicas `/q/` em proxy (se necessário)
3. Migration 0019 pode ser mantida (não quebra nada, apenas adiciona tabelas)
4. Se erro em schema: `psql < db/0019_reverse.sql` (criar script se necessário)

---

**Deploy Date:** [Preenchido na execução]  
**Deployed By:** [Nome]  
**Approval:** [Nome] — [Data]  

---

*Este checklist é um guia vivo — atualizar conforme problemas reais encontrados em produção.*

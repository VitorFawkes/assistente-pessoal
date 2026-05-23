# Agentes — leia ANTES de mexer

Este projeto começou como **assistente pessoal do Vitor** e agora está virando
**multi-tenant** (beta semi-aberto de 50-200 pessoas): mac-agent + PWA gravam
áudios → n8n processa (Whisper + GPT-4o-transcribe-diarize) → Postgres com RLS
+ frontend Next.js com auth por convite + voice-svc Python pra fingerprinting.

Leia também:
- `README.md` — visão geral do produto
- `docs/superpowers/specs/2026-05-21-foundation-multitenant-design.md` — spec do multi-tenant
- `docs/superpowers/plans/2026-05-21-foundation-multitenant.md` — plano de execução
- `frontend/AGENTS.md` — **Next.js 16 tem APIs diferentes** (`middleware.ts`→`proxy.ts`, cookies async); regras multi-tenant pro frontend
- `voice-svc/README.md` — microservice de voz
- `db/README.md` — migrations + roles Postgres (app_tenant / app_writer)

---

## 🏢 Multi-tenant (foundation v2 — **AO VIVO EM PROD 2026-05-22/23**)

**Status DB:** `0007_multitenant.sql` aplicada.
- 17 meetings + 17 tarefas + 7 pessoas + 19 voice_samples backfilled pro Vitor
- Vitor UUID: `7740e829-9462-416b-81a1-b787e23ba9b2` (is_admin=true)
- RLS habilitada em 6 tabelas + 6 policies + 4 CHECK constraints validadas
- Roles `app_tenant` (NOBYPASSRLS) e `app_writer` (BYPASSRLS) criados

**Status deploys (todos OK):**
- ✅ Frontend deployado com código novo (proxy.ts, withTenant, helpers, auth)
- ✅ **Frontend conecta como `app_tenant`** → RLS ativo, isolamento real validado
- ✅ Workflows n8n `Acoes - Audio Ingest` + `Acoes - Process Segment` propagam user_id
- ✅ n8n env tem `VITOR_FALLBACK_UUID` setado
- ✅ voice-svc deployado com código novo (user_id em todas queries)
- ✅ mac-agent reloaded com `WEBHOOK_USER_ID=7740e829-...`
- ✅ `/api/admin/reprocess-meeting/[id]` exige user_id no body (escopado via withTenant)

**Status n8n/voice-svc DATABASE_URL:** ainda `assistente` (BYPASSRLS). Funciona
porque propagam user_id explícito nos INSERTs. Trocar pra `app_writer` (mesma senha
em `~/.config/superpowers/multitenant-roles.txt`) é melhoria opcional.

**Teste e2e (2026-05-22 21:00):**
- Vitor logado: vê 17 meetings + 13 tarefas ✓
- Beta Teste 1 (convite consumido + termos aceitos): vê "Nenhuma reunião" ✓
- Convite reusado: "Convite não está mais válido" ✓
- Redirect /termos no primeiro acesso ✓

A partir de `db/0007_multitenant.sql`:
- **users / invites / sessions / audit_log / usage_events** são tabelas novas
- **meetings, tarefas, pessoas, voice_samples** ganharam `user_id NOT NULL` (via CHECK NOT VALID + VALIDATE)
- **RLS habilitada** em meetings/tarefas/pessoas/voice_samples/usage_events/tarefa_eventos
- **2 roles Postgres separados:**
  - `app_tenant` (NOBYPASSRLS) → frontend Next.js; `lib/db.ts` faz `SET LOCAL app.current_user_id` por request via `withTenant(userId, fn)`
  - `app_writer` (BYPASSRLS) → n8n + voice-svc; propagam `user_id` explícito em INSERTs/SELECTs
- **Pessoas**: `UNIQUE (user_id, nome)` (não global). `is_vitor` é por-user
- **Auth**: cookie httpOnly 30d sliding, validado em `proxy.ts` (Node runtime nativo Next 16) + `requireUser()` / `requireUserOrRedirect()` / `withAuth()` em `lib/auth.ts`
- **Invite**: `/admin/convites` (Vitor cria, copia link, manda no WhatsApp); página `/c/[code]` consome com rate-limit
- **Termos LGPD**: usuário aceita em `/termos` antes do app (column `users.consent_terms_at`); proxy força redirect se NULL

**Antes de tocar qualquer query:** leia `frontend/AGENTS.md` seção "Multi-tenant: regras críticas". Resumo:
- Dados de usuário → helpers tipados em `lib/queries.ts` (meetingsFor, tarefasFor, pessoasFor, voiceSamplesFor)
- Queries de sistema (sessions/invites/users/audit_log) → `query()` direto de `lib/db.ts`
- Páginas com `requireUser()` precisam de `export const dynamic = 'force-dynamic'`

---

## 🚨 DÉBITO TÉCNICO CONHECIDO

### 1. Postgres sem pgvector

**O quê:** A tabela `voice_samples` armazena embeddings ECAPA-TDNN (192d
floats L2-normalizados) numa coluna `REAL[]`, não `vector(192)`.

**Por quê:** A imagem do Postgres no easypanel é `postgres:17` oficial,
que **não** vem com a extensão pgvector. Verificação:

```sql
SELECT name FROM pg_available_extensions WHERE name='vector';
-- → vazio (2026-05-19)
```

**Impacto:** A busca de similaridade (top-K vizinhos) em
[`voice-svc/db.py`](voice-svc/db.py) `search_top_k()` é feita em Python
via `numpy`: SELECT all active samples → matrix multiplication → sort.
Complexidade O(n) por query. Em escala single-user com até ~10.000
amostras é imperceptível.

**🔴 Se buscas por voz ficarem lentas no futuro, ESTA é a causa
provável.** Confirme rodando `SELECT count(*) FROM voice_samples WHERE
soft_deleted_at IS NULL` — se passar de ~10k, está na hora de migrar.

**Como migrar pra pgvector quando virar problema:**

1. Backup do DB (`pg_dump` via dbgate ou pgweb).
2. No easypanel UI, service `assistente-pessoal-db`: trocar imagem de
   `postgres:17` pra `pgvector/pgvector:pg17`. **Atenção:** easypanel
   pode não preservar o volume nomeado — daí o backup.
3. Restaurar backup se necessário.
4. Aplicar:
   ```sql
   CREATE EXTENSION vector;
   ALTER TABLE voice_samples
     ALTER COLUMN embedding TYPE vector(192) USING embedding::vector;
   CREATE INDEX voice_samples_hnsw
     ON voice_samples USING hnsw (embedding vector_cosine_ops)
     WHERE soft_deleted_at IS NULL;
   ```
5. Reverter `voice-svc/db.py` `search_top_k` pra usar operador `<=>`
   (cosine distance do pgvector). A versão pgvector original está no git
   blame — buscar commit anterior a 2026-05-19.
6. Reverter `voice-svc/requirements.txt` pra adicionar `pgvector==0.3.4`.
7. Atualizar `voice-svc/Dockerfile` se houver menção a pgvector (não há
   atualmente).
8. Apagar este aviso aqui em `AGENTS.md` e remover warnings em
   `db/0005_voice_samples.sql` e `voice-svc/db.py`.

---

## Convenções rápidas

- **Banco:** Postgres direto via `pg` (frontend) e `psycopg3` (voice-svc).
  Schemas em `db/000X_*.sql`, aplicar em ordem. Não há migration tool
  automatizada — aplicar manualmente via dbgate/pgweb ou similar.
- **Frontend:** Next.js 16 + Tailwind 4 + React 19. Estética "warm paper",
  Fraunces pra display, Geist pro corpo. Ver `frontend/components/` pra
  padrões.
- **Mac-agent:** bash scripts em `mac-agent/`. Lê áudio do iCloud,
  transcreve com **AssemblyAI Universal-3-Pro** (`speech_models=["universal-3-pro","universal-2"]`)
  com `speaker_labels=true`, envia ao n8n via webhook. Migrado em 2026-05-23
  de `gpt-4o-transcribe-diarize` (que tinha limite efetivo de 1500s/chamada
  e resetava speaker labels entre chunks manuais). Backup do pipeline OpenAI
  em `mac-agent/transcribe-openai.sh.bak` pra rollback. Env: `ASSEMBLYAI_API_KEY`,
  opcional `SPEECH_MODELS_JSON`, `POLL_INTERVAL`, `POLL_MAX_SECONDS`.
  Benchmark validado: meeting de 70min em **65s single-shot, 4 speakers consistentes**
  (vs antigo 4 chunks paralelos + 7 letras fragmentadas).
- **n8n:** workflows em `n8n-workflows/*.json`. NUNCA usar MCP tools do
  n8n (não funcionam). Acesso via curl com `N8N_API_KEY` do `.env`.
  **URL correta:** `https://n8n.vitorgambetti.com.br/` — NÃO o subdomínio
  easypanel `n8n-n8n.ymnmx7.easypanel.host` (key só funciona no domínio
  custom). Workflows:
  - `Acoes - Audio Ingest` (id `98jEiWWSAKFWEP6B`) — pipeline principal de
    áudios. Adiciona `needs_segmentation=true` em meetings >60min via nós
    12c/12d.
  - `Acoes - Process Segment` (id `Gt34r0WVdZxCbJet`) — disparado pelo PATCH
    `/api/meetings/[id]/segments` pra cada filho criado. Extrai tarefas via
    GPT-5.1 e dispara voice-svc/identify.
  - `Acoes - Reprocess Tarefas` — disparado pelo PATCH `/api/meetings/[id]/speakers`
    quando user corrige rotulação.
  - Pra sincronizar JSON local → live: `source .env && ./n8n-workflows/apply.sh`.
  - **Multi-tenant**: workflows propagam `user_id` recebido via header
    `X-User-Id` ou body, com fallback pra `$env.VITOR_FALLBACK_UUID` durante
    rollout.

- **Frontend (URL pública):** `https://n8n-assistente-frontend.tatetz.easypanel.host/`
  — o domínio `acoes.vitorgambetti.com.br` está com 404 do Traefik (DNS ou
  basic auth quebrado). NÃO usar `acoes.vitorgambetti.com.br` até consertar.
  Páginas autenticadas: `/`, `/reunioes`, `/reunioes/[id]`, `/reunioes/[id]/identificar`,
  `/reunioes/[id]/segmentar`, `/pessoas`, `/pessoas/[id]`, `/seguranca/sessoes`,
  `/termos`, `/admin/convites`. Páginas públicas: `/sem-acesso`, `/c/[code]`.
- **Easypanel:** API tRPC em `EASYPANEL_URL/api/trpc/*`. Mutations
  funcionam pra create/update/deploy/restart de services, **mas não há
  endpoint pra mounts**. Mounts são gerenciados via UI. **CUIDADO:**
  `services.app.updateEnv` substitui TODO o env (texto multilinha) — pra
  adicionar 1 var, ler env atual via `inspectService` e preservar o resto.

- **CI/CD:** ambos `frontend/` e `voice-svc/` têm pre-build no GitHub
  Actions → GHCR (`.github/workflows/{frontend,voice-svc}.yml`). Easypanel
  consome `image: ghcr.io/vitorfawkes/assistente-pessoal-{frontend,voice-svc}:latest`
  via `source.type=image`. Deploy de ~17s vs ~30-55min se fosse build no
  easypanel host. Packages devem estar PUBLIC em
  github.com/users/VitorFawkes/packages.

---

## Endpoints-chave

Todos os Route Handlers que retornam dados de usuário usam `withAuth(fn)` que
chama `requireUser()` automaticamente e retorna 401/403 se não-autenticado.

| Endpoint | Função |
|----------|--------|
| `POST /api/sessao` | Consome invite (form-encoded ou JSON), cria sessão, seta cookie. Rate-limit 5/min/IP |
| `DELETE /api/sessao` | Logout (revoga sessão atual + deleta cookie) |
| `POST /api/sessao/revoke-all` | Logout de todos os dispositivos |
| `PATCH /api/meetings/[id]/speakers` | Salva rotulação de speakers (escopado, dispara n8n reprocess + voice-svc/enroll em background) |
| `POST /api/meetings/[id]/identify` | Proxy pra voice-svc/identify (passa user_id; sugestões automáticas) |
| `PATCH /api/meetings/[id]/segments` | Fatia meeting longa em N filhos (multi-tenant safe). Modos: `{cuts:[...]}` (fatia), `{archive_only:true}` (só arquiva), `{mark_single:true}` (limpa flag), `{restore:true}` (volta archived → done). Roda ffmpeg local + transação postgres + dispara `Acoes - Process Segment` |
| `POST /api/save-audio` | **Público** — chamado pelo n8n; exige header `X-User-Id` |
| `voice-svc:8000/identify` | Embeda speakers, retorna top match (escopado por `user_id`) |
| `voice-svc:8000/enroll` | Adiciona amostras de voz (idempotente por user+meeting+letter+pessoa) |
| `voice-svc:8000/samples/{id}` (DELETE/PATCH) | Soft delete / reassign (exige `user_id` query/body) |
| `voice-svc:8000/clip?user_id=...` | Recorta trecho MP3 (valida ownership do meeting) |

---

## Segmentação de áudios longos

Áudios > 60min ganham flag `needs_segmentation=true` automaticamente. UI em
`/reunioes/[id]/segmentar` permite revisar cortes propostos pelo detector
heurístico (`frontend/lib/detect-cuts.ts`) e confirmar fatiamento.

**Schema:** `db/0006_meeting_segmentation.sql` adiciona `parent_meeting_id`,
`segment_index`, `segment_start_offset`, `segment_end_offset`,
`needs_segmentation` em `meetings`. Status `archived_session` é o estado do
pai após fatiar; filhos têm `source='segmented'`.

**Detector:** thresholds calibrados pro pipeline atual onde `transcribe.sh`
aplica `silenceremove` antes do Whisper (gaps reais entre turnos ficam <25s).
Constantes em `DETECT_CONSTANTS`: `SILENCE_HARD=20`, `SILENCE_SOFT=10`,
`MIN_SEGMENT_DURATION=600`, `CONFIDENCE_FLOOR=0.7`. Testes em
`frontend/lib/detect-cuts.test.ts` (`bun test`).

**ffmpeg:** o handler PATCH escreve direto em `/audios/YYYY/MM/<uuid>.mp3`
(reencode pra 64kbps mono 16kHz — `-c copy` quebra em `.m4a` iPhone com MOOV
no final, e `/tmp` ≠ `/audios` no mount easypanel).

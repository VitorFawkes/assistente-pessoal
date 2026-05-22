# Agentes — leia ANTES de mexer

Este projeto é o **assistente pessoal do Vitor**: mac-agent grava áudios →
n8n processa (Whisper + GPT-4o-transcribe-diarize) → Postgres + frontend
Next.js + voice-svc Python pra fingerprinting de voz.

Leia também:
- `README.md` — visão geral do produto
- `frontend/AGENTS.md` — **Next.js 16 tem APIs diferentes**, consultar `node_modules/next/dist/docs/` antes de escrever código de frontend
- `voice-svc/README.md` — microservice de voz

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
  transcreve com `gpt-4o-transcribe-diarize`, envia ao n8n via webhook.
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

- **Frontend (URL pública):** `https://n8n-assistente-frontend.tatetz.easypanel.host/`
  — o domínio `acoes.vitorgambetti.com.br` está com 404 do Traefik (DNS ou
  basic auth quebrado). NÃO usar `acoes.vitorgambetti.com.br` até consertar.
  Páginas: `/reunioes`, `/reunioes/[id]`, `/pessoas`, `/pessoas/[id]`.
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

| Endpoint | Função |
|----------|--------|
| `PATCH /api/meetings/[id]/speakers` | Salva rotulação de speakers (nome→pessoa_id), dispara n8n reprocess + voice-svc/enroll em background |
| `POST /api/meetings/[id]/identify` | Proxy pra voice-svc/identify (sugestões automáticas) |
| `PATCH /api/meetings/[id]/segments` | Fatia meeting longa em N filhos. Modos: `{cuts:[...]}` (fatia), `{archive_only:true}` (só arquiva), `{mark_single:true}` (limpa flag), `{restore:true}` (volta archived → done). Roda ffmpeg local + transação postgres + dispara `Acoes - Process Segment` |
| `voice-svc:8000/identify` | Embeda speakers, retorna top match contra base |
| `voice-svc:8000/enroll` | Adiciona amostras de voz ao DB (idempotente por meeting+letter+pessoa) |
| `voice-svc:8000/samples/{id}` (DELETE) | Soft delete de amostra ruim |

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

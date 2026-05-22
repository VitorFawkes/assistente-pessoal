# Assistente Pessoal — Captura de Reuniões → Action Items

Pipeline que pega áudios de reuniões (gravados no Mac ou iPhone), transcreve, extrai automaticamente as ações combinadas (suas e delegadas, com prazo quando mencionado) e te entrega no WhatsApp + numa página web própria.

> **Status:** virando multi-tenant (beta semi-aberto 50-200 pessoas via convite). Foundation v2 entregue em `db/0007_multitenant.sql` + helpers em `frontend/lib/`. Roadmap em 6 sub-projetos — ver `docs/superpowers/specs/2026-05-21-foundation-multitenant-design.md`.

## Como funciona

```
Áudio cai em pasta local
      │
      ▼
fswatch detecta (Mac)
      │
      ▼
watcher.sh POST multipart → n8n webhook
      │
      ▼
n8n: salva no volume → Whisper transcreve → GPT-5.1 extrai ações JSON
      │
      ▼
Postgres: INSERT meeting + N tarefas
      │
      ▼
Evolution API: WhatsApp com resumo + lista de ações
      │
      ▼
Frontend Next.js: dashboard de pendências (Minhas | Delegadas | Vencendo)
```

## Estrutura

```
.
├── README.md                       # este arquivo
├── AGENTS.md                       # convenções pra agentes/IDEs (ler antes de tocar código)
├── .env.example                    # template das variáveis
├── db/
│   ├── README.md                   # como aplicar migrations + roles Postgres
│   ├── 0001_schema.sql .. 0006_meeting_segmentation.sql
│   └── 0007_multitenant.sql        # users/sessions/invites + RLS + backfill
├── mac-agent/                      # detector local de novos áudios (envia c/ X-User-Id)
├── n8n-workflows/                  # JSONs versionados + apply.sh (sync via curl)
│   ├── acoes-audio-ingest.json
│   ├── acoes-process-segment.json
│   ├── acoes-digest.json
│   └── apply.sh                    # PUT em batch no n8n live
├── voice-svc/                      # FastAPI + SpeechBrain ECAPA (fingerprinting de voz)
├── frontend/                       # Next.js 16 + Tailwind 4 + React 19
│   ├── AGENTS.md                   # regras Next 16 + multi-tenant (auth, cache, queries)
│   ├── proxy.ts                    # valida sessão (Node runtime, ex-middleware.ts)
│   ├── lib/
│   │   ├── auth.ts                 # requireUser/withAuth/consumeInvite/cookie
│   │   ├── db.ts                   # withTenant (SET LOCAL app.current_user_id)
│   │   ├── queries.ts              # helpers tipados (meetingsFor, tarefasFor, ...)
│   │   └── rate-limit.ts
│   └── app/                        # rotas + Route Handlers + Server Actions
└── docs/superpowers/               # specs e plans (brainstorm → writing-plans)
```

## Setup — ordem

1. **Folder Action do Voice Memos** (Mac, manual, ~5min) — ver `mac-agent/README.md` seção "Voice Memos"
2. **Easypanel — provisionar Postgres + Volume + Frontend** (via API; precisa do token)
3. **Rodar migrations** `db/0001_schema.sql` ... `db/0007_multitenant.sql` em ordem — ver `db/README.md` (a 0007 exige roles `app_tenant` + `app_writer` criados antes)
4. **n8n — workflows** já criados via API; configurar credenciais Postgres (`app_writer`) e Evolution. `./n8n-workflows/apply.sh` pra sincronizar
5. **Mac agent — `cd mac-agent && ./install.sh`** (instala fswatch + carrega launchd). Precisa de `WEBHOOK_USER_ID` no `.env` (UUID do seu user)
6. **Frontend — deploy no easypanel** (build Docker; auth multi-tenant substitui Basic Auth via `/sem-acesso` + link de convite)

Cada etapa tem seu próprio README com detalhes.

## Variáveis de ambiente

Veja `.env.example`. Resumo:

- `WEBHOOK_URL` / `WEBHOOK_TOKEN` / `WEBHOOK_USER_ID` — endpoint do n8n que recebe os áudios + auth + UUID do dono
- `MACBOOK_FOLDER` / `IPHONE_FOLDER` — pastas que o fswatch observa no Mac
- `DATABASE_URL` — Postgres do easypanel. Pós-0007 use **roles separados**: `app_tenant` (frontend, NOBYPASSRLS) e `app_writer` (n8n + voice-svc, BYPASSRLS)
- `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` / `WHATSAPP_DESTINO` — envio das mensagens
- `NEXT_PUBLIC_BASE_URL` — URL pública usada por `/admin/convites` pra montar links de convite

## Estado atual

Veja a checklist no fim deste README ou rode:
```bash
launchctl list | grep assistente-pessoal   # Mac agent rodando?
curl -s "$N8N_URL/api/v1/workflows?tags=acoes" -H "X-N8N-API-KEY: $N8N_API_KEY" | jq '.data[].name'   # workflows ativos
psql "$DATABASE_URL" -c "SELECT count(*), status FROM meetings GROUP BY status;"   # ingestão funcionando
```

## Comandos úteis

```bash
# Re-disparar webhook com um arquivo já existente
source .env
curl -X POST "$WEBHOOK_URL" \
  -H "X-Auth: $WEBHOOK_TOKEN" \
  -H "X-Source: macbook" \
  -F "audio=@/Users/vitorgambetti/Documents/AudiosMacbook/online - 20260517 1633.mp3"

# Ver últimas reuniões
psql "$DATABASE_URL" -c "SELECT id, status, recorded_at, length(transcription) FROM meetings ORDER BY created_at DESC LIMIT 10;"

# Ver tarefas abertas
psql "$DATABASE_URL" -c "SELECT titulo, owner, prazo, prioridade FROM tarefas WHERE status='aberta' ORDER BY prazo NULLS LAST;"
```

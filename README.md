# Assistente Pessoal — Captura de Reuniões → Action Items

Pipeline que pega áudios de reuniões (gravados no Mac ou iPhone), transcreve, extrai automaticamente as ações combinadas (suas e delegadas, com prazo quando mencionado) e te entrega no WhatsApp + numa página web própria.

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
├── README.md                  # este arquivo
├── .env.example               # template das variáveis
├── db/
│   └── 0001_schema.sql        # schema Postgres (meetings, tarefas, eventos)
├── mac-agent/                 # detector local de novos áudios
│   ├── audio-watcher.sh
│   ├── com.vitor.assistente-pessoal.plist
│   ├── install.sh
│   ├── uninstall.sh
│   └── README.md              # passo a passo (inclui Folder Action do Voice Memos)
├── n8n-workflows/             # JSONs versionados (referência — workflows reais vivem no n8n)
│   ├── acoes-audio-ingest.json
│   └── acoes-digest.json
└── frontend/                  # Next.js 16 + shadcn (dashboard de tarefas)
```

## Setup — ordem

1. **Folder Action do Voice Memos** (Mac, manual, ~5min) — ver `mac-agent/README.md` seção "Voice Memos"
2. **Easypanel — provisionar Postgres + Volume + Frontend** (via API; precisa do token)
3. **Rodar `db/0001_schema.sql`** no Postgres novo
4. **n8n — workflows** já criados via API; só configurar credenciais Postgres e Evolution
5. **Mac agent — `cd mac-agent && ./install.sh`** (instala fswatch + carrega launchd)
6. **Frontend — deploy no easypanel** (build Docker + ativar Basic Auth no proxy)

Cada etapa tem seu próprio README com detalhes.

## Variáveis de ambiente

Veja `.env.example`. Resumo:

- `WEBHOOK_URL` / `WEBHOOK_TOKEN` — endpoint do n8n que recebe os áudios
- `MACBOOK_FOLDER` / `IPHONE_FOLDER` — pastas que o fswatch observa no Mac
- `DATABASE_URL` — Postgres do easypanel (usado por n8n e frontend)
- `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` / `WHATSAPP_DESTINO` — envio das mensagens

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

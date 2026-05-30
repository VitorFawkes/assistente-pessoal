# ingest-svc

Recebe upload de áudio do app iOS, comprime + transcreve + repassa pro n8n.
Substitui o trabalho que o `mac-agent` (audio-watcher.sh + transcribe.sh) faz hoje
pro Vitor, mas pra outros usuários que não têm o Mac dele.

- **Stack**: Python 3.11 + FastAPI + ffmpeg + httpx
- **Modelo de transcrição**: AssemblyAI Universal-2 (com fallback Universal-3-Pro) —
  mesmo do mac-agent desde 2026-05-23. Single-shot até 10h, diarização global.
- **Contrato pro n8n**: idêntico ao `audio-watcher.sh:243-261` — workflow não muda

## Arquitetura

```
App iOS (Swift)
    ↓ POST /upload (multipart: audio + recorded_at + original_filename)
    ↓ headers: X-Auth, X-User-Id
ingest-svc
    ↓ ffmpeg volumedetect → silent gate (-50dB)
    ↓ ffmpeg compress + silenceremove (48kbps mono 16kHz)
    ↓ AssemblyAI:
    ↓   POST /v2/upload (body binary) → upload_url
    ↓   POST /v2/transcript (speaker_labels=true, speech_models=[u3-pro, u2], lang=pt) → transcript_id
    ↓   polling GET /v2/transcript/<id> até status=completed (default 8s, timeout 30min)
    ↓   converte utterances [{speaker, start_ms, end_ms, text}] → segments {start_s, end_s}
    ↓ POST webhook n8n acoes-audio-ingest (mesmo contrato do mac-agent)
n8n workflow "Acoes - Audio Ingest" (inalterado)
    → cria meeting → /api/save-audio → GPT tarefas → voice-svc/identify → WhatsApp
```

## Endpoints

### `GET /health`
Liveness + estado de configuração.
```json
{
  "status": "ok",
  "config": {
    "n8n_configured": true,
    "assemblyai_configured": true,
    "auth_configured": true,
    "speech_models": ["universal-3-pro", "universal-2"],
    "max_upload_mb": 500
  }
}
```

### `POST /upload`

Aceita 2 esquemas de autenticação (escolha um):

**Path 1 — app iOS (recomendado, multi-tenant):**
- `Authorization: Bearer <session_token>` — token retornado por `POST /api/auth/mobile/exchange` no frontend
- `user_id` é extraído automaticamente via `GET /api/internal/validate-session` no frontend (auth com `INTERNAL_SVC_TOKEN` shared secret)

**Path 2 — legacy mac-agent (compat):**
- `X-Auth: <INGEST_TOKEN>` — mesmo WEBHOOK_TOKEN do .env raiz
- `X-User-Id: <UUID>` — UUID do usuário (tabela users)

Form fields (multipart/form-data):
- `audio` — arquivo (.m4a, .mp3, .wav, .aac, .flac, .ogg, .mp4)
- `recorded_at` — ISO 8601 (ex: `2026-05-26T14:30:00Z`)
- `original_filename` — nome original (usado pra derivar `meeting_type` por prefixo "mic - " / "online - ")
- `source` — opcional, default `"ios-app"`
- `meeting_type` — opcional, default derivado do filename (`"online"` / `"presencial"` / `"desconhecido"`)

Response (sucesso):
```json
{
  "ok": true,
  "http_code": 200,
  "duration_seconds": 1845,
  "silent": false,
  "n_chunks": 1,
  "transcription_chars": 12450,
  "segments_count": 87
}
```

## Variáveis de ambiente

| Var | Default | Função |
|-----|---------|--------|
| `ASSEMBLYAI_API_KEY` | (obrigatório) | API key — https://www.assemblyai.com/app/api-keys |
| `INGEST_TOKEN` | (obrigatório) | Token estático no header X-Auth (= WEBHOOK_TOKEN do mac-agent) |
| `INTERNAL_SVC_TOKEN` | (obrigatório p/ iOS) | Shared secret entre ingest-svc e frontend (`openssl rand -hex 32`). Mesma string no env do frontend. |
| `FRONTEND_INTERNAL_URL` | (obrigatório p/ iOS) | Base URL interna do frontend (no easypanel: `http://assistente-frontend:3000`). |
| `N8N_WEBHOOK_URL` | (obrigatório) | URL do webhook n8n acoes-audio-ingest |
| `SPEECH_MODELS_JSON` | `["universal-3-pro","universal-2"]` | Lista ordenada (AssemblyAI faz fallback automático) |
| `POLL_INTERVAL` | `8` | Segundos entre polls de status AssemblyAI |
| `POLL_MAX_SECONDS` | `1800` | Timeout total de polling (cobre 8h+ de áudio) |
| `N8N_TIMEOUT_SECONDS` | `300` | Timeout do POST pro n8n |
| `MAX_UPLOAD_BYTES` | `524288000` | Limite de upload (500MB default) |

## Build e teste local

```bash
cd ingest-svc
cp .env.example .env
# preencha .env com ASSEMBLYAI_API_KEY, INGEST_TOKEN, N8N_WEBHOOK_URL

# opção 1: rodar direto (precisa Python 3.11+ e ffmpeg local)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
set -a && source .env && set +a
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# opção 2: rodar via Docker
docker build -t ingest-svc .
docker run --rm --env-file .env -p 8000:8000 ingest-svc

# health check
curl http://localhost:8000/health | jq

# upload de teste — pegue um .m4a real do Voice Memos
# Path 1 (legacy mac-agent):
curl -X POST http://localhost:8000/upload \
  -H "X-Auth: $INGEST_TOKEN" \
  -H "X-User-Id: 00000000-0000-0000-0000-000000000000" \
  -F "audio=@/path/to/test.m4a" \
  -F "recorded_at=2026-05-26T14:30:00Z" \
  -F "original_filename=test.m4a" \
  -F "source=test"

# Path 2 (app iOS — Bearer):
# Pegue token via POST /api/auth/mobile/exchange no frontend primeiro.
curl -X POST http://localhost:8000/upload \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -F "audio=@/path/to/test.m4a" \
  -F "recorded_at=2026-05-26T14:30:00Z" \
  -F "original_filename=test.m4a" \
  -F "source=ios-app"
```

## Deploy easypanel

Replica o padrão do `voice-svc`:

1. **Service** `ingest-svc` no projeto `n8n` (mesmo cluster do voice-svc e n8n)
2. **Source**: GitHub `VitorFawkes/assistente-pessoal`, branch `main`, **Build Path** `/ingest-svc`
3. **Env**: `ASSEMBLYAI_API_KEY`, `INGEST_TOKEN`, `N8N_WEBHOOK_URL`, `INTERNAL_SVC_TOKEN`, `FRONTEND_INTERNAL_URL=http://assistente-frontend:3000`
4. **Port**: `8000`
5. **Domain público**: necessário (app iOS chama de fora) — sugestão `ingest.acoes.vitorgambetti.com.br`
6. **Resources**: 1 vCPU / 1 GB RAM (ffmpeg é leve, transcrição é remoto)
7. **Healthcheck**: GET `/health`

## Troubleshooting

- **`AssemblyAI 401`** → `ASSEMBLYAI_API_KEY` errada ou conta inativa.
- **`AssemblyAI status inesperado: ...`** → conta sem acesso a `universal-3-pro`? Verifica
  dashboard ou ajusta `SPEECH_MODELS_JSON=["universal-2"]`.
- **`polling timeout`** → áudio enorme (>8h) ou AssemblyAI lento. Aumenta `POLL_MAX_SECONDS`.
- **`n8n rejected http=401`** → INGEST_TOKEN diferente do WEBHOOK_TOKEN que o n8n
  workflow valida. Confirme que são o mesmo valor.
- **`n8n rejected http=400 X-User-Id obrigatório`** → header não chegou; ver logs
  pra confirmar que o app iOS está mandando.

## Diferenças vs mac-agent/transcribe.sh

Funcionalmente equivalente. Diferenças de implementação:
- Python em vez de bash (mais fácil de testar e debugar com httpx async)
- `_aai_poll` usa `asyncio.sleep` em vez de bash `sleep`
- Não tem `move_to_processed` (request é stateless, não tem pasta)
- Não tem `wait_until_stable` nem `materialize_for_upload` (iCloud não se aplica;
  o upload do app iOS já entrega bytes completos)
- Não tem `derive_source` (`source` vem como form field)

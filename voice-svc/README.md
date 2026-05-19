# voice-svc

Microservice de fingerprinting de voz pro AssistentePessoal. Identifica quem é
cada speaker numa reunião comparando embeddings contra uma base que cresce a
cada correção do usuário.

- **Modelo**: SpeechBrain ECAPA-TDNN (`speechbrain/spkrec-ecapa-voxceleb`), 192d, CPU-only
- **Storage**: pgvector + tabela `voice_samples`
- **Stack**: Python 3.11 + FastAPI + torch CPU + ffmpeg

## Pré-requisitos

1. **pgvector instalado no Postgres**. Verificar:
   ```sql
   SELECT extversion FROM pg_extension WHERE extname='vector';
   ```
   Se vazio, trocar imagem Postgres no easypanel pra `pgvector/pgvector:pg16` (ou compatível) antes de continuar.

2. **Migrations aplicadas**: `db/0004_pessoas.sql` e `db/0005_voice_samples.sql`.

3. **Volume `audios` montado** — mesmo mount usado pelo n8n e pelo frontend (read-only basta pro voice-svc).

## Variáveis de ambiente

| Var | Default | Função |
|-----|---------|--------|
| `DATABASE_URL` | (obrigatório) | string Postgres com pgvector instalado |
| `AUDIO_BASE` | `/audios` | base path do volume de áudio (prefixa paths relativos) |
| `TURN_MAX_SECONDS` | `30` | máximo de segundos por turno embedado |
| `CONFIDENCE_THRESHOLD` | `0.60` | similaridade mínima pra propor um match |
| `HIGH_CONFIDENCE` | `0.80` | acima disso, UI destaca como match forte |
| `MARGIN_THRESHOLD` | `0.08` | diferença mínima top1 vs top2 (pessoas diferentes) |
| `TOP_K` | `5` | quantos vizinhos buscar no pgvector |

## Endpoints

### `GET /health`
Liveness + thresholds atuais. Útil pra healthcheck do easypanel.

### `POST /identify`
```json
{ "meeting_id": "uuid" }
```
Lê `meetings.segments` + áudio, embeda speakers, busca match contra `voice_samples`. Grava resultado em `meetings.speaker_labels_proposed` e retorna:
```json
{
  "labels": {
    "A": { "pessoa_id": "uuid", "nome": "Vitor", "confidence": 0.94, "sample_count": 12, "margin": 0.18 },
    "B": null
  }
}
```
`null` = sem proposta (cold start, threshold ou margem insuficiente).

### `POST /enroll`
```json
{
  "meeting_id": "uuid",
  "mapping": { "A": "pessoa_uuid_vitor", "B": "pessoa_uuid_ana" }
}
```
Extrai trechos representativos por speaker, embeda e insere em `voice_samples`. Retorna:
```json
{ "enrolled": { "A": 3, "B": 2 } }
```

### `DELETE /samples/{id}`
Soft delete (seta `soft_deleted_at`). Idempotente. Próxima identify ignora amostras deletadas.

## Build local

```bash
cd voice-svc
docker build -t voice-svc .
docker run --rm -e DATABASE_URL="$DATABASE_URL" -v /path/to/audios:/audios:ro -p 8000:8000 voice-svc
```

Smoke test:
```bash
curl http://localhost:8000/health
```

## Deploy easypanel

1. **Adicionar service** `voice-svc` no projeto `n8n`.
2. **Source**: GitHub `VitorFawkes/assistente-pessoal`, branch `main`, **Build Path** `/voice-svc`.
3. **Mounts**:
   - Volume `audios` → `/audios` (read-only)
4. **Env**:
   - `DATABASE_URL` → mesma string usada pelo frontend (`postgres://...@n8n_assistente-pessoal-db:5432/...`)
5. **Port**: `8000` (interna apenas — sem domínio público; acesso pelo n8n e frontend via DNS interno do easypanel `voice-svc:8000`)
6. **Resources**: 1 vCPU / 2 GB RAM mínimo (modelo torch + ffmpeg).
7. **Healthcheck**: GET `/health`.

> **Primeiro build é lento** (~5 min): instala torch CPU + speechbrain + baixa modelo (17MB).

## Integração

- **n8n workflow `acoes-audio-ingest`** chama `POST http://voice-svc:8000/identify` depois do node "8. GPT Extract Actions" — vai gravar `speaker_labels_proposed` automaticamente.
- **Frontend** `PATCH /api/meetings/[id]/speakers` dispara `POST http://voice-svc:8000/enroll` em background depois que o usuário confirma o mapeamento.

(Integrações são entregues na Fase 3.)

## Troubleshooting

- **`ERROR: extension "vector" is not available`** → trocar imagem Postgres pra pgvector.
- **`audio não encontrado: /audios/...`** → conferir mount no easypanel; o path no DB precisa existir dentro do container.
- **`speaker X sem turnos válidos`** → diarização não gerou trechos ≥ 3s pra esse speaker; nada a fazer (qualidade do áudio).
- **Identify retorna `null` pra todos** → base vazia. Faça enroll manual em 3-5 reuniões antes de esperar propostas.
- **Imagem muito grande** → confirmar que `torch` foi instalado do index CPU (`https://download.pytorch.org/whl/cpu`), não do default (que puxa CUDA).

# voice-svc

Microservice de fingerprinting de voz pro AssistentePessoal. Identifica quem é
cada speaker numa reunião comparando embeddings contra uma base que cresce a
cada correção do usuário.

- **Modelo**: SpeechBrain ECAPA-TDNN (`speechbrain/spkrec-ecapa-voxceleb`), 192d, CPU-only
- **Storage**: Postgres com coluna `REAL[]` (ver Débito técnico abaixo)
- **Stack**: Python 3.11 + FastAPI + torch CPU + ffmpeg

---

## 🚨 Débito técnico — sem pgvector

A coluna `voice_samples.embedding` é **`REAL[]`** em vez de `vector(192)`
porque a imagem `postgres:17` do easypanel não tem pgvector instalado.

Consequência: `search_top_k()` em [`db.py`](db.py) faz `SELECT all + numpy`
em vez de busca ANN indexada. Funciona até ~10k amostras sem dor — passou
disso, migrar pra pgvector.

**Instruções completas de migração** em [`/AGENTS.md`](../AGENTS.md) na
raiz do projeto.

---

## Pré-requisitos

1. **Migrations aplicadas**: `db/0004_pessoas.sql` e `db/0005_voice_samples.sql`.
2. **Volume `audios` montado** — mesmo mount usado pelo n8n e pelo frontend
   (read-only basta pro voice-svc).

## Variáveis de ambiente

| Var | Default | Função |
|-----|---------|--------|
| `DATABASE_URL` | (obrigatório) | string Postgres |
| `AUDIO_BASE` | `/audios` | base path do volume (prefixa paths relativos) |
| `TURN_MAX_SECONDS` | `30` | máximo de segundos por turno embedado |
| `CONFIDENCE_THRESHOLD` | `0.60` | similaridade mínima pra propor um match |
| `HIGH_CONFIDENCE` | `0.80` | acima disso, UI destaca como match forte |
| `MARGIN_THRESHOLD` | `0.08` | diferença mínima top1 vs top2 (pessoas diferentes) |
| `TOP_K` | `5` | quantos vizinhos buscar |

## Endpoints

### `GET /health`
Liveness + thresholds atuais. Útil pra healthcheck do easypanel.

### `POST /identify`
```json
{ "meeting_id": "uuid" }
```
Lê `meetings.segments` + áudio, embeda speakers, busca match contra
`voice_samples`. Grava resultado em `meetings.speaker_labels_proposed` e
retorna:
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
Extrai trechos representativos por speaker, embeda e insere em
`voice_samples`. **Idempotente** por (meeting, letter, pessoa) —
seguro chamar várias vezes.

### `DELETE /samples/{id}`
Soft delete (`soft_deleted_at`). Idempotente. Próxima identify ignora.

## Build local

```bash
cd voice-svc
docker build -t voice-svc .
docker run --rm -e DATABASE_URL="$DATABASE_URL" -v /path/to/audios:/audios:ro -p 8000:8000 voice-svc
curl http://localhost:8000/health
```

## Deploy easypanel

1. **Service** `voice-svc` no projeto `n8n` (já provisionado via API em 2026-05-19).
2. **Source**: GitHub `VitorFawkes/assistente-pessoal`, branch `main`, **Build Path** `/voice-svc`.
3. **Mounts** (manual via UI — API não expõe):
   - Volume `audios` → `/audios` (read-only)
4. **Env**: `DATABASE_URL`, `AUDIO_BASE=/audios`, `PYTHONUNBUFFERED=1`
5. **Port**: `8000` (interna apenas — sem domínio público; acesso pelo n8n
   e frontend via DNS interno do easypanel `voice-svc:8000`)
6. **Resources**: 1 vCPU / 2 GB RAM mínimo (torch + ffmpeg).
7. **Healthcheck**: GET `/health`.

> **Primeiro build é lento** (~5 min): instala torch CPU + speechbrain.

## Integração

- **n8n workflow `acoes-audio-ingest`** chama `POST http://voice-svc:8000/identify`
  depois do node "8. GPT Extract Actions" — popula `speaker_labels_proposed`.
- **Frontend** `PATCH /api/meetings/[id]/speakers` dispara
  `POST http://voice-svc:8000/enroll` em background depois que o usuário
  confirma o mapeamento.
- **UI** tem botão "identificar por voz" que chama
  `POST /api/meetings/[id]/identify` (proxy → voice-svc) sob demanda.

## Troubleshooting

- **`audio não encontrado: /audios/...`** → conferir mount no easypanel; o
  path no DB precisa existir dentro do container.
- **`speaker X sem turnos válidos`** → diarização não gerou trechos ≥ 3s
  pra esse speaker; nada a fazer (qualidade do áudio).
- **Identify retorna `null` pra todos** → base vazia. Faça enroll manual
  em 3-5 reuniões antes de esperar propostas.
- **Imagem muito grande** → confirmar que `torch` foi instalado do index
  CPU (`https://download.pytorch.org/whl/cpu`), não do default (CUDA).
- **Busca por voz ficou lenta** → ver `/AGENTS.md` raiz, seção "Débito
  técnico — sem pgvector".

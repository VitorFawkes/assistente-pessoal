# ingest-svc — recebe áudio do app iOS, comprime + transcreve, repassa pro n8n.
#
# Substitui o trabalho que o mac-agent faz hoje (audio-watcher.sh + transcribe.sh).
# Imagem leve: python:3.11-slim + ffmpeg. Sem torch/speechbrain (voice-svc faz fingerprinting separado).
#
# Build: docker build -t ingest-svc .
# Run:   docker run -e OPENAI_API_KEY=... -e INGEST_TOKEN=... -e N8N_WEBHOOK_URL=... -p 8000:8000 ingest-svc

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=600

# ffmpeg pra compress + silenceremove + chunking. ca-certificates pra TLS do OpenAI/n8n.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

EXPOSE 8000

# 1 worker: o backpressure (semaphore), o set de tasks em voo e o sweep de jobs
# órfãos no startup são por-processo. Com 2 workers o sweep rodaria duas vezes
# (re-processando órfãos em duplicidade) e o limite de concorrência viraria 2.
# O upload responde 202 na hora e o ffmpeg roda em thread (asyncio.to_thread),
# então 1 worker atende uploads concorrentes sem travar o event loop.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

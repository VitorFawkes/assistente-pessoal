# voice-svc — fingerprinting de voz com SpeechBrain ECAPA-TDNN
#
# Build: docker build -t voice-svc .
# Run:   docker run -e DATABASE_URL=... -v audios:/audios:ro -p 8000:8000 voice-svc
#
# Imagem final ~1.5GB (torch CPU + speechbrain + ffmpeg). Modelo (17MB) baixa
# no primeiro startup via lifespan — assim o build não depende de rede HF
# durante o build remoto.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=600

# ffmpeg pra extrair trechos do áudio source
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip

# Torch CPU-only via index dedicado (~500MB vs ~1.5GB com CUDA).
# Separado em RUN próprio pra cachear independente das outras deps.
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch==2.1.2 torchaudio==2.1.2

# Demais deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Diretório onde SpeechBrain vai cachear o modelo no primeiro request
ENV SB_MODEL_CACHE=/app/model_cache
RUN mkdir -p "$SB_MODEL_CACHE"

COPY *.py ./

EXPOSE 8000

# Único worker — modelo fica em memória, single-user, sem benefício de fan-out
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

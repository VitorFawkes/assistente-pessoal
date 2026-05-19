# voice-svc — fingerprinting de voz com SpeechBrain ECAPA-TDNN
#
# Build: docker build -t voice-svc .
# Run:   docker run -e DATABASE_URL=... -v audios:/audios:ro -p 8000:8000 voice-svc
#
# Imagem final ~1.5GB (torch CPU + speechbrain + ffmpeg + modelo cacheado).

FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg pra extrair trechos do áudio source
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Torch CPU-only via index dedicado (~500MB vs ~1.5GB com CUDA)
RUN pip install --upgrade pip && \
    pip install \
      --index-url https://download.pytorch.org/whl/cpu \
      torch==2.1.2 torchaudio==2.1.2

# Demais deps
COPY requirements.txt .
RUN pip install -r requirements.txt

# Pré-baixa o modelo ECAPA-TDNN (17MB) pra evitar cold start na primeira request
ENV SB_MODEL_CACHE=/app/model_cache
RUN mkdir -p "$SB_MODEL_CACHE" && \
    python -c "from speechbrain.inference.speaker import EncoderClassifier; \
EncoderClassifier.from_hparams(source='speechbrain/spkrec-ecapa-voxceleb', \
savedir='$SB_MODEL_CACHE', run_opts={'device': 'cpu'})"

COPY *.py ./

EXPOSE 8000

# Único worker — modelo fica em memória, single-user, sem benefício de fan-out
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

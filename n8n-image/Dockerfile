FROM n8nio/n8n:2.20.6

USER root
RUN apk add --no-cache ffmpeg bash curl jq

COPY transcribe.sh /scripts/transcribe.sh
RUN chmod +x /scripts/transcribe.sh

USER node

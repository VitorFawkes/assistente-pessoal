FROM n8nio/n8n:2.20.6

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl jq ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /scripts

COPY transcribe.sh /scripts/transcribe.sh
RUN chmod +x /scripts/transcribe.sh

USER node

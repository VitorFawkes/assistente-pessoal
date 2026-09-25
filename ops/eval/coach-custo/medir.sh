#!/bin/bash
# Roda o medidor com as mesmas variáveis COACH_* do Coach em produção, lidas do servidor sem imprimir nada.
# Precisa do .env local (VPS_SSH_*, OPENAI_API_KEY) e do dump em $DUMP. Veja README.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HOME/AssistentePessoal/.env}"
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'; }
SSH_KEY="$(get VPS_SSH_KEY_PATH)"; SSH_KEY="${SSH_KEY/#\~/$HOME}"
eval "$(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -n "$(get VPS_SSH_USER)@$(get VPS_SSH_HOST)" \
  "docker service inspect n8n_assistente-frontend --format '{{json .Spec.TaskTemplate.ContainerSpec.Env}}'" \
  | python3 -c '
import json,sys,shlex
for e in json.load(sys.stdin):
    k,_,v=e.partition("=")
    if k.startswith("COACH_"): print("export "+k+"="+shlex.quote(v))
')"
export REAL_OPENAI_KEY="$(get OPENAI_API_KEY)"
export COACH_USER_ID="${COACH_USER_ID:-$(get WEBHOOK_USER_ID)}"
export DATABASE_URL="postgres://127.0.0.1:${MIRROR_PORT:-5433}/postgres"
export TZ=UTC
cd "$HERE"
[ -d node_modules ] || bun install --silent
exec bun medir.ts "$@"

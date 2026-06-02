#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# sweep-stuck-meetings.sh
# Auto-cura meetings travadas em 'analyzing' (transcritas, mas o n8n não
# terminou a extração de tarefas — falha silenciosa do GPT/voice-svc, sem
# retry nem 'error'). Re-dispara a extração via webhook acoes-process-segment
# (reusa a transcrição existente; NÃO re-transcreve).
#
# Roda no VPS via cron (a cada 15min):
#   */15 * * * * /root/sweep-stuck-meetings.sh >> /root/sweep.log 2>&1
#
# Secrets: lê WEBHOOK_TOKEN de /root/.sweep-env (chmod 600) ou do env.
# DB: usa o env do próprio container (POSTGRES_USER/PASSWORD/DB).
# ─────────────────────────────────────────────────────────────────────
set -u
[ -f /root/.sweep-env ] && . /root/.sweep-env

PSURL="${PSURL:-https://n8n.vitorgambetti.com.br/webhook/acoes-process-segment}"
DB_CONTAINER_MATCH="${DB_CONTAINER_MATCH:-n8n_assistente-pessoal-db}"
WINDOW_MIN="${WINDOW_MIN:-15}"      # só travadas há +15min (dá tempo do fluxo normal)
WINDOW_MAX_DAYS="${WINDOW_MAX_DAYS:-2}"  # não ressuscita órfãs antigas
LIMIT="${LIMIT:-5}"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

if [ -z "${WEBHOOK_TOKEN:-}" ]; then
  echo "$(ts) ERRO: WEBHOOK_TOKEN ausente (defina em /root/.sweep-env)"; exit 1
fi

cid="$(docker ps -q -f "name=$DB_CONTAINER_MATCH" | head -1)"
if [ -z "$cid" ]; then
  echo "$(ts) ERRO: container DB ($DB_CONTAINER_MATCH) não encontrado"; exit 1
fi

# Busca travadas em 'analyzing' COM transcrição (recuperável via process-segment).
SQL="SELECT id::text || '|' || user_id::text
       FROM meetings
      WHERE status = 'analyzing'
        AND transcription IS NOT NULL AND length(transcription) > 0
        AND created_at < now() - interval '${WINDOW_MIN} minutes'
        AND created_at > now() - interval '${WINDOW_MAX_DAYS} days'
      ORDER BY created_at
      LIMIT ${LIMIT};"

rows="$(printf '%s' "$SQL" | docker exec -i "$cid" sh -c \
  'PGPASSWORD=$POSTGRES_PASSWORD psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -f -' 2>/dev/null)"

rows="$(printf '%s\n' "$rows" | sed '/^$/d')"
if [ -z "$rows" ]; then
  echo "$(ts) ok — nenhuma meeting travada"
  exit 0
fi

n=0
printf '%s\n' "$rows" | while IFS='|' read -r mid uid; do
  [ -z "$mid" ] || [ -z "$uid" ] && continue
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 90 -X POST "$PSURL" \
    -H "x-auth: $WEBHOOK_TOKEN" -H "x-user-id: $uid" -H "Content-Type: application/json" \
    -d "{\"meeting_id\":\"$mid\",\"user_id\":\"$uid\"}")"
  echo "$(ts) reprocess meeting=$mid user=$uid http=$code"
  n=$((n + 1))
done
echo "$(ts) sweep concluído"

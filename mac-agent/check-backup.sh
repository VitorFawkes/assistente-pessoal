#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# check-backup.sh — safety net pra validação do multi-tenant
#
# Roda via cron (a cada 30 min). Cruza arquivos em ~/Documents/AudiosBackup/
# (criados pelo audio-watcher.sh) com meetings no DB via API admin.
# Se algum arquivo do backup NÃO tem meeting correspondente, alerta via
# notificação macOS nativa (osascript).
#
# Remove quando a confiança no pipeline novo estiver consolidada.
# ─────────────────────────────────────────────────────────────────────

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

: "${WEBHOOK_TOKEN:?WEBHOOK_TOKEN não definida no .env}"
: "${WEBHOOK_USER_ID:?WEBHOOK_USER_ID não definida no .env}"
FRONTEND_DOMAIN="${FRONTEND_DOMAIN:-n8n-assistente-frontend.tatetz.easypanel.host}"

BACKUP_DIR="$HOME/Documents/AudiosBackup"
LOG="$SCRIPT_DIR/check-backup.log"

# Cria pasta de backup se ainda não existe (idempotente)
mkdir -p "$BACKUP_DIR"

# Pega lista de meetings recentes (últimas 48h)
API_URL="https://$FRONTEND_DOMAIN/api/admin/check-recent-meetings?user_id=$WEBHOOK_USER_ID&hours=48"
resp=$(curl -sS --max-time 15 "$API_URL" -H "X-Admin-Token: $WEBHOOK_TOKEN" 2>/dev/null)
if [ -z "$resp" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] API offline ou sem resposta" >> "$LOG"
  exit 0
fi

# Lista filenames já no DB
db_files=$(echo "$resp" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  for m in d.get('meetings', []):
    fn = m.get('original_filename', '')
    if fn: print(fn)
except Exception as e:
  print(f'PARSE_ERR: {e}', file=sys.stderr)
")

if [ -z "$db_files" ]; then
  total=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count', '?'))" 2>/dev/null)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] API retornou 0 meetings (count=$total) — verifica auth/user_id" >> "$LOG"
fi

# Lista arquivos no backup das últimas 48h
missing=()
total_files=0
while IFS= read -r f; do
  total_files=$((total_files + 1))
  bn=$(basename "$f")
  if ! echo "$db_files" | grep -Fxq "$bn"; then
    missing+=("$bn")
  fi
done < <(find "$BACKUP_DIR" -type f -mtime -2 \( -name "*.mp3" -o -name "*.m4a" -o -name "*.wav" -o -name "*.aac" -o -name "*.flac" -o -name "*.ogg" -o -name "*.mp4" \) 2>/dev/null)

ts="$(date '+%Y-%m-%d %H:%M:%S')"
if [ ${#missing[@]} -gt 0 ]; then
  shown="${missing[*]:0:3}"
  msg="⚠️ ${#missing[@]} áudio(s) no backup SEM meeting no DB (de $total_files no backup): $shown"
  echo "[$ts] $msg" >> "$LOG"
  # Notificação macOS (escapa aspas duplas)
  safe_msg=$(printf '%s' "$msg" | sed 's/"/\\"/g')
  osascript -e "display notification \"$safe_msg\" with title \"Assistente Pessoal — Safety Net\"" 2>/dev/null || true
else
  echo "[$ts] OK — $total_files arquivos no backup (48h), todos com meeting no DB" >> "$LOG"
fi

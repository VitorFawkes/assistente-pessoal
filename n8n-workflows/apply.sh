#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# n8n-workflows/apply.sh
# Aplica os JSONs versionados nesse diretório no n8n live via API.
# Pré-requisitos:
#   - source .env (carrega N8N_API_KEY)
#   - jq disponível
#   - VITOR_FALLBACK_UUID configurado no env do service n8n (easypanel UI)
#     antes de aplicar, senão Node 3 do audio-ingest vai falhar pra
#     requisições sem header X-User-Id
#
# Uso:
#   source .env && ./n8n-workflows/apply.sh
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

: "${N8N_API_KEY:?N8N_API_KEY ausente — source .env}"
N8N_URL="${N8N_URL:-https://n8n.vitorgambetti.com.br}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

apply_workflow() {
  local id="$1"
  local file="$2"
  local name="$3"

  echo "→ $name ($id)"
  if [ ! -f "$SCRIPT_DIR/$file" ]; then
    echo "  ERRO: arquivo $file não existe"
    return 1
  fi

  # n8n API espera só {name, nodes, connections, settings, ...} — não inclui
  # id/createdAt/updatedAt. Os JSONs locais já estão limpos.
  local resp
  resp=$(curl -sS -X PUT "$N8N_URL/api/v1/workflows/$id" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    --data @"$SCRIPT_DIR/$file")

  if echo "$resp" | jq -e '.id' > /dev/null 2>&1; then
    local updated_at
    updated_at=$(echo "$resp" | jq -r '.updatedAt')
    echo "  ✓ updated at $updated_at"
  else
    echo "  ✗ erro: $resp"
    return 1
  fi
}

apply_workflow "98jEiWWSAKFWEP6B" "acoes-audio-ingest.json"      "Acoes - Audio Ingest"
apply_workflow "Gt34r0WVdZxCbJet" "acoes-process-segment.json"    "Acoes - Process Segment"
apply_workflow "l1xcOvuEru496Zql" "acoes-reprocess-tarefas.json"  "Acoes - Reprocess Tarefas"

echo ""
echo "Pronto. Verifica que os workflows continuam ativos:"
echo '  curl -s "$N8N_URL/api/v1/workflows/98jEiWWSAKFWEP6B" -H "X-N8N-API-KEY: $N8N_API_KEY" | jq .active'
echo '  curl -s "$N8N_URL/api/v1/workflows/Gt34r0WVdZxCbJet" -H "X-N8N-API-KEY: $N8N_API_KEY" | jq .active'

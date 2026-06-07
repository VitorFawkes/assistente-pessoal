#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# ops/recover-meeting-segments.sh <meeting_id>
#
# Recupera a diarização (segments) + speakers de uma meeting cujo ÁUDIO ainda
# existe mas os segments foram perdidos (ex: reprocesso que zerou e re-gravou
# segments=[]). Re-transcreve via AssemblyAI (assíncrono, robusto p/ áudio longo)
# e dispara o webhook n8n `acoes-reprocess-meeting` — que restaura segments e
# re-extrai tarefas com texto separado por speaker.
#
# Por que não usar /api/admin/reprocess-meeting direto?
#   Aquela rota transcreve SÍNCRONO com gpt-4o-transcribe-diarize em chunks; em
#   áudio longo (>~30min) estoura o timeout do gateway (502) e o do fetch, e o
#   handler é abortado quando o cliente desconecta. Este script desacopla a
#   transcrição (AssemblyAI faz async) e só usa o webhook (rápido) p/ gravar.
#
# Pré-req: source .env (ASSEMBLYAI_API_KEY, WEBHOOK_TOKEN, VPS_*), jq, sshpass.
# Uso:     source .env && ops/recover-meeting-segments.sh <meeting_id>
# Depois:  confirmar os speakers na UI /reunioes/<id> (re-extrai com nomes).
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail
MID="${1:?uso: recover-meeting-segments.sh <meeting_id>}"
: "${ASSEMBLYAI_API_KEY:?source .env}" "${WEBHOOK_TOKEN:?}" "${VPS_ROOT_PASSWORD:?}" "${VPS_SSH_HOST:?}" "${VPS_SSH_USER:?}"
N8N_URL="${N8N_URL:-https://n8n.vitorgambetti.com.br}"
AAI="https://api.assemblyai.com"

SSH(){ sshpass -p "$VPS_ROOT_PASSWORD" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=20 "${VPS_SSH_USER}@${VPS_SSH_HOST}" "$@"; }
DBC=$(SSH "docker ps --format '{{.Names}}' | grep assistente-pessoal-db | head -1")
FE=$(SSH "docker ps --format '{{.Names}}' | grep assistente-frontend | head -1")
PSQL(){ SSH "docker exec -i $DBC psql -U assistente -d assistente_pessoal -At -F'|'" 2>/dev/null | grep -viE 'collation|detail|hint|rebuild'; }

echo "→ metadata da meeting $MID"
META=$(echo "select user_id, coalesce(recorded_at::text,''), source, coalesce(meeting_type,'desconhecido'), audio_path from meetings where id='$MID';" | PSQL | grep '|')
UID_M=$(echo "$META"|cut -d'|' -f1); REC=$(echo "$META"|cut -d'|' -f2)
SRC=$(echo "$META"|cut -d'|' -f3); MT=$(echo "$META"|cut -d'|' -f4); AP=$(echo "$META"|cut -d'|' -f5)
[ -n "$UID_M" ] || { echo "✗ meeting não encontrada"; exit 1; }
echo "  user=$UID_M source=$SRC tipo=$MT audio=$AP"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "→ baixando áudio"
SSH "docker exec $FE cat '$AP'" > "$TMP/audio.mp3"
echo "  $(wc -c <"$TMP/audio.mp3") bytes"

echo "→ AssemblyAI: upload + transcript (diarização)"
URL=$(curl -sS -X POST "$AAI/v2/upload" -H "Authorization: $ASSEMBLYAI_API_KEY" --data-binary @"$TMP/audio.mp3" | jq -r '.upload_url')
TID=$(curl -sS -X POST "$AAI/v2/transcript" -H "Authorization: $ASSEMBLYAI_API_KEY" -H "Content-Type: application/json" \
  -d "$(jq -nc --arg u "$URL" '{audio_url:$u,language_code:"pt",speaker_labels:true,speech_models:["universal-3-pro","universal-2"]}')" | jq -r '.id')
echo "  transcript id=$TID — polling…"
ST=""
for i in $(seq 1 120); do
  S=$(curl -sS "$AAI/v2/transcript/$TID" -H "Authorization: $ASSEMBLYAI_API_KEY")
  ST=$(echo "$S"|jq -r '.status')
  [ "$ST" = completed ] && break
  [ "$ST" = error ] && { echo "✗ AssemblyAI erro: $(echo "$S"|jq -r .error)"; exit 1; }
  sleep 10
done
[ "$ST" = completed ] || { echo "✗ transcrição não completou (status=$ST)"; exit 1; }
echo "$S" | jq -c '[.utterances[]?|select((.speaker//"")|test("^[A-Z]+$"))|{speaker,start:(.start/1000),end:(.end/1000),text}]' > "$TMP/seg.json"
echo "$S" | jq -r '.text//""' > "$TMP/text.txt"
echo "  segments=$(jq length "$TMP/seg.json") speakers=$(jq -c '[.[].speaker]|unique' "$TMP/seg.json")"

echo "→ webhook acoes-reprocess-meeting (restaura segments + re-extrai)"
python3 - "$MID" "$UID_M" "$REC" "$SRC" "$MT" "$TMP" <<'PY'
import json,sys
mid,uid,rec,src,mt,tmp=sys.argv[1:7]
seg=json.load(open(tmp+'/seg.json')); text=open(tmp+'/text.txt',encoding='utf-8').read().strip()
json.dump({"meeting_id":mid,"user_id":uid,"text":text,"segments":seg,
           "recorded_at":rec or None,"source":src,"meeting_type":mt},
          open(tmp+'/wh.json','w'), ensure_ascii=False)
PY
curl -sS -X POST "$N8N_URL/webhook/acoes-reprocess-meeting" -H "Content-Type: application/json" \
  -H "x-auth: $WEBHOOK_TOKEN" --data @"$TMP/wh.json" -w '\n  HTTP %{http_code}\n' --max-time 120

echo "→ identify (voice-svc) — sugere nomes dos speakers"
cat > "$TMP/_id.js" <<JS
fetch((process.env.VOICE_SVC_URL||'http://voice-svc:8000')+'/identify',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({meeting_id:'$MID',user_id:'$UID_M'}),
  signal:AbortSignal.timeout(120000)})
 .then(async r=>console.log('  identify',r.status,(await r.text()).slice(0,400)))
 .catch(e=>console.log('  identify err',e.message))
JS
SSH "docker exec -i $FE sh -c 'cat > /tmp/_id.js && bun /tmp/_id.js'" < "$TMP/_id.js" || true

echo "✓ pronto. Confirme os speakers na UI: ${N8N_URL%/*}/reunioes/$MID (ou o domínio do front)"

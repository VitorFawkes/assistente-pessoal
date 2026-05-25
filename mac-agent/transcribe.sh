#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# transcribe.sh — pipeline de transcrição com diarização via AssemblyAI Universal-2
#
# Substituiu gpt-4o-transcribe-diarize (que tinha limite efetivo de 1500s/chamada e
# resetava speaker labels entre chunks). AssemblyAI faz diarização global de áudios
# até 10h em uma única chamada, mantendo letras de speaker consistentes.
#
# Uso:
#   ./transcribe.sh <audio_file>
#
# Faz:
#   1. ffmpeg volumedetect → detecta silêncio total (gate)
#   2. ffmpeg compress + silenceremove (48kbps mono 16kHz)
#   3. ffprobe pega duração do ORIGINAL
#   4. Upload pro AssemblyAI (/v2/upload)
#   5. Solicita transcrição com diarização (/v2/transcript)
#   6. Polling até status=completed
#   7. Converte utterances → segments {speaker, start, end, text}
#
# Output (stdout): JSON
#   { text, duration_seconds, silent, n_chunks, compressed_path, segments }
#
# segments = [{ speaker, start, end, text }, ...]
# AssemblyAI diariza globalmente: speaker "A" no minuto 0 É a mesma pessoa que
# "A" no minuto 200 (não reseta como o pipeline antigo OpenAI chunked).
#
# Backup do pipeline OpenAI antigo em mac-agent/transcribe-openai.sh.bak.
#
# Dependências: ffmpeg, ffprobe, curl, jq
# Env: ASSEMBLYAI_API_KEY
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

INPUT="${1:?uso: transcribe.sh <audio_file>}"
[ -f "$INPUT" ] || { echo "ERR input não existe: $INPUT" >&2; exit 1; }
: "${ASSEMBLYAI_API_KEY:?ASSEMBLYAI_API_KEY não definida}"

# config
SILENCE_GATE_DB="-50"
SILENCEREMOVE_DB="-50dB"
SILENCEREMOVE_MIN="2"
BITRATE="48k"
SAMPLE_RATE="16000"
ASSEMBLYAI_BASE="https://api.assemblyai.com"
# speech_models: lista de fallback ordenada. AssemblyAI tenta o primeiro;
# se indisponível ou conta sem acesso, cai pro próximo. Universal-3 Pro é
# o mais accurate pra PT-BR (otimizado especificamente); Universal-2 é
# o fallback estável e mais barato.
SPEECH_MODELS_JSON="${SPEECH_MODELS_JSON:-[\"universal-3-pro\",\"universal-2\"]}"
POLL_INTERVAL="${POLL_INTERVAL:-8}"          # seg entre polls de status
POLL_MAX_SECONDS="${POLL_MAX_SECONDS:-1800}" # 30min limite total de polling (cobre 8h de áudio)

TMPDIR_JOB="$(mktemp -d -t transcribe-XXXXXX)"
log() { echo "[transcribe] $*" >&2; }
cleanup() { :; }  # tmpdir é cleanedup pelo OS
trap cleanup EXIT

# ─── 1. silêncio total ────────────────────────────────────────────
log "analisando volume de $(basename "$INPUT")"
MEAN_VOL=$(ffmpeg -i "$INPUT" -af volumedetect -vn -f null - 2>&1 \
  | grep -oE 'mean_volume: -?[0-9.]+' | head -1 | awk '{print $2}' || echo "0")
log "mean_volume=${MEAN_VOL}dB (gate=${SILENCE_GATE_DB}dB)"

DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$INPUT" 2>/dev/null || echo "0")
DURATION_INT=$(printf '%.0f' "$DURATION")

if awk -v v="$MEAN_VOL" -v g="$SILENCE_GATE_DB" 'BEGIN{exit !(v+0 <= g+0)}'; then
  log "SILENT — pulando API"
  COMPRESSED="$TMPDIR_JOB/compressed.mp3"
  ffmpeg -hide_banner -loglevel error -y -i "$INPUT" \
    -ar "$SAMPLE_RATE" -ac 1 -b:a "$BITRATE" "$COMPRESSED"
  jq -n --argjson dur "$DURATION_INT" --arg p "$COMPRESSED" \
    '{text:"", duration_seconds:$dur, silent:true, n_chunks:0, compressed_path:$p, segments:[]}'
  exit 0
fi

# ─── 2. comprime + silenceremove ──────────────────────────────────
COMPRESSED="$TMPDIR_JOB/compressed.mp3"
log "comprimindo + silenceremove"
ffmpeg -hide_banner -loglevel error -y -i "$INPUT" \
  -af "silenceremove=stop_periods=-1:stop_duration=${SILENCEREMOVE_MIN}:stop_threshold=${SILENCEREMOVE_DB}" \
  -ar "$SAMPLE_RATE" -ac 1 -b:a "$BITRATE" \
  "$COMPRESSED"

COMP_SIZE=$(stat -f%z "$COMPRESSED" 2>/dev/null || stat -c%s "$COMPRESSED")
log "comprimido=${COMP_SIZE}B"

# ─── 3. Upload pro AssemblyAI ────────────────────────────────────
log "upload pra AssemblyAI"
UPLOAD_RESP=$(curl -sS -X POST "$ASSEMBLYAI_BASE/v2/upload" \
  -H "Authorization: $ASSEMBLYAI_API_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$COMPRESSED")
UPLOAD_URL=$(echo "$UPLOAD_RESP" | jq -r '.upload_url // empty')
if [ -z "$UPLOAD_URL" ]; then
  echo "ERR upload falhou: $UPLOAD_RESP" >&2
  exit 1
fi
log "upload OK (url=${UPLOAD_URL:0:60}...)"

# ─── 4. Solicita transcrição com diarização ───────────────────────
log "solicitando transcrição (speech_models=$SPEECH_MODELS_JSON, speaker_labels=true, language=pt)"
REQ_BODY=$(jq -n \
  --arg url "$UPLOAD_URL" \
  --argjson models "$SPEECH_MODELS_JSON" \
  '{audio_url: $url, language_code: "pt", speaker_labels: true, speech_models: $models}')
TRANS_RESP=$(curl -sS -X POST "$ASSEMBLYAI_BASE/v2/transcript" \
  -H "Authorization: $ASSEMBLYAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$REQ_BODY")
TRANS_ID=$(echo "$TRANS_RESP" | jq -r '.id // empty')
if [ -z "$TRANS_ID" ]; then
  echo "ERR transcript request falhou: $TRANS_RESP" >&2
  exit 1
fi
log "transcript_id=$TRANS_ID"

# ─── 5. Polling ───────────────────────────────────────────────────
START_TS=$(date +%s)
STATUS_RESP=""
while true; do
  STATUS_RESP=$(curl -sS "$ASSEMBLYAI_BASE/v2/transcript/$TRANS_ID" \
    -H "Authorization: $ASSEMBLYAI_API_KEY")
  STATUS=$(echo "$STATUS_RESP" | jq -r '.status // "unknown"')
  ELAPSED=$(( $(date +%s) - START_TS ))
  case "$STATUS" in
    completed)
      log "completed em ${ELAPSED}s"
      break
      ;;
    error)
      ERR=$(echo "$STATUS_RESP" | jq -r '.error // "unknown"')
      echo "ERR AssemblyAI: $ERR" >&2
      exit 1
      ;;
    queued|processing)
      if [ "$ELAPSED" -gt "$POLL_MAX_SECONDS" ]; then
        echo "ERR polling timeout após ${POLL_MAX_SECONDS}s (último status=$STATUS)" >&2
        exit 1
      fi
      log "status=$STATUS (elapsed=${ELAPSED}s), aguardando ${POLL_INTERVAL}s"
      sleep "$POLL_INTERVAL"
      ;;
    *)
      echo "ERR status inesperado: $STATUS — resp=$(echo "$STATUS_RESP" | head -c 300)" >&2
      exit 1
      ;;
  esac
done

# ─── 6. Constrói output JSON compatível com schema antigo ─────────
# AssemblyAI retorna utterances [{speaker, start (ms), end (ms), text, words}].
# Convertendo pra segments [{speaker, start (s), end (s), text}].
# Filtra labels não [A-Z]+ por segurança (defesa contra futuras mudanças do modelo).
TEXT=$(echo "$STATUS_RESP" | jq -r '.text // ""')
SEGMENTS=$(echo "$STATUS_RESP" | jq '[
  .utterances[]? |
    select((.speaker // "") | test("^[A-Z]+$")) |
    {speaker, start: (.start / 1000), end: (.end / 1000), text}
]')

# Conta speakers distintos pra log
N_SPEAKERS=$(echo "$SEGMENTS" | jq '[.[].speaker] | unique | length')
N_TURNS=$(echo "$SEGMENTS" | jq 'length')
log "saída: ${N_TURNS} turnos, ${N_SPEAKERS} speakers distintos"

jq -n \
  --arg t "$TEXT" \
  --argjson dur "$DURATION_INT" \
  --arg p "$COMPRESSED" \
  --argjson seg "$SEGMENTS" \
  '{text:$t, duration_seconds:$dur, silent:false, n_chunks:1, compressed_path:$p, segments:$seg}'

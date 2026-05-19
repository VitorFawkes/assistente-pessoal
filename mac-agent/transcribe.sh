#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# transcribe.sh — pipeline completo de transcrição (roda no Mac)
#
# Uso:
#   ./transcribe.sh <audio_file>
#
# Faz:
#   1. ffmpeg volumedetect → detecta silêncio total (gate)
#   2. ffmpeg compress + silenceremove (48kbps mono 16kHz)
#   3. ffprobe pega duração do ORIGINAL
#   4. Se compressed > 24MB → chunka, transcreve em paralelo, concatena
#   5. Senão → 1× chamada Whisper
#
# Output (stdout): JSON
#   { text, duration_seconds, silent, n_chunks, compressed_path }
#
# Logs vão pro stderr. compressed_path fica em /tmp e é responsabilidade
# do caller dar rm depois de usar.
#
# Dependências: ffmpeg, ffprobe, curl, jq
# Env necessária: OPENAI_API_KEY
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

INPUT="${1:?uso: transcribe.sh <audio_file>}"
[ -f "$INPUT" ] || { echo "ERR input não existe: $INPUT" >&2; exit 1; }
: "${OPENAI_API_KEY:?OPENAI_API_KEY não definida}"

# config
SILENCE_GATE_DB="-50"           # se mean_volume <= isso → silent total
SILENCEREMOVE_DB="-30dB"        # threshold do silenceremove
SILENCEREMOVE_MIN="2"           # silêncios > 2s são removidos
BITRATE="48k"
SAMPLE_RATE="16000"
CHUNK_SECONDS="1500"            # 25 min por chunk
MAX_BYTES=$((24 * 1024 * 1024)) # 24MB de margem (whisper limit 25MB)
PARALLEL=4                       # chunks em paralelo

# diretório temp dedicado a este job (NÃO removido — caller usa o compressed)
TMPDIR_JOB="$(mktemp -d -t transcribe-XXXXXX)"

log() { echo "[transcribe] $*" >&2; }

# ─── 1. detecta silêncio total ────────────────────────────────────
log "analisando volume de $(basename "$INPUT")"
MEAN_VOL=$(ffmpeg -i "$INPUT" -af volumedetect -vn -f null - 2>&1 \
  | grep -oE 'mean_volume: -?[0-9.]+' | head -1 | awk '{print $2}' || echo "0")
log "mean_volume=${MEAN_VOL}dB (gate=${SILENCE_GATE_DB}dB)"

# duração do ORIGINAL
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$INPUT" 2>/dev/null || echo "0")
DURATION_INT=$(printf '%.0f' "$DURATION")

# se MEAN_VOL <= SILENCE_GATE_DB → silêncio total
if awk -v v="$MEAN_VOL" -v g="$SILENCE_GATE_DB" 'BEGIN{exit !(v+0 <= g+0)}'; then
  log "SILENT — pulando Whisper, compressed = cópia direta"
  COMPRESSED="$TMPDIR_JOB/compressed.mp3"
  # ainda gera compressed pra o player do site ter algo leve
  ffmpeg -hide_banner -loglevel error -y -i "$INPUT" \
    -ar "$SAMPLE_RATE" -ac 1 -b:a "$BITRATE" "$COMPRESSED"
  jq -n --argjson dur "$DURATION_INT" --arg p "$COMPRESSED" \
    '{text:"", duration_seconds:$dur, silent:true, n_chunks:0, compressed_path:$p}'
  exit 0
fi

# ─── 2. comprime + silenceremove ──────────────────────────────────
COMPRESSED="$TMPDIR_JOB/compressed.mp3"
log "comprimindo + silenceremove → compressed.mp3"
ffmpeg -hide_banner -loglevel error -y -i "$INPUT" \
  -af "silenceremove=stop_periods=-1:stop_duration=${SILENCEREMOVE_MIN}:stop_threshold=${SILENCEREMOVE_DB}" \
  -ar "$SAMPLE_RATE" -ac 1 -b:a "$BITRATE" \
  "$COMPRESSED"

# stat tamanho do compressed (macOS usa -f%z, linux -c%s)
COMP_SIZE=$(stat -f%z "$COMPRESSED" 2>/dev/null || stat -c%s "$COMPRESSED")
log "tamanho comprimido=${COMP_SIZE} bytes (limite=${MAX_BYTES})"

# helper: chama Whisper num arquivo, ecoa só o .text
whisper_call() {
  local file="$1"
  local resp
  resp=$(curl -sS -X POST "https://api.openai.com/v1/audio/transcriptions" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F "model=whisper-1" \
    -F "language=pt" \
    -F "response_format=json" \
    -F "file=@${file}")
  if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
    echo "ERR whisper: $resp" >&2
    return 1
  fi
  echo "$resp" | jq -r '.text // ""'
}

# ─── 3a. cabe em um upload só ──────────────────────────────────────
if [ "$COMP_SIZE" -le "$MAX_BYTES" ]; then
  log "single-shot Whisper"
  TEXT=$(whisper_call "$COMPRESSED")
  jq -n --arg t "$TEXT" --argjson dur "$DURATION_INT" --arg p "$COMPRESSED" \
    '{text:$t, duration_seconds:$dur, silent:false, n_chunks:1, compressed_path:$p}'
  exit 0
fi

# ─── 3b. chunka + processa em paralelo ─────────────────────────────
log "chunking em segmentos de ${CHUNK_SECONDS}s"
CHUNK_PREFIX="$TMPDIR_JOB/chunk_"
ffmpeg -hide_banner -loglevel error -y -i "$COMPRESSED" \
  -f segment -segment_time "$CHUNK_SECONDS" \
  -c copy "${CHUNK_PREFIX}%03d.mp3"

# array de chunks ordenado
CHUNKS=()
while IFS= read -r f; do CHUNKS+=("$f"); done < <(ls -1 "$TMPDIR_JOB"/chunk_*.mp3 | sort)
N=${#CHUNKS[@]}
log "n_chunks=$N — transcrevendo paralelo (max=$PARALLEL)"

# transcreve cada chunk → arquivo .txt
transcribe_chunk_to_file() {
  local chunk="$1"
  local out="${chunk%.mp3}.txt"
  if whisper_call "$chunk" > "$out"; then
    log "  ok: $(basename "$chunk")"
  else
    log "  FAIL: $(basename "$chunk")"
    return 1
  fi
}
export -f whisper_call transcribe_chunk_to_file log
export OPENAI_API_KEY

printf '%s\n' "${CHUNKS[@]}" | xargs -I{} -P "$PARALLEL" \
  bash -c 'transcribe_chunk_to_file "$@"' _ {}

# concatena na ordem
FULL_TEXT=""
for c in "${CHUNKS[@]}"; do
  txt="${c%.mp3}.txt"
  [ -f "$txt" ] || { echo "ERR chunk faltando: $txt" >&2; exit 1; }
  if [ -z "$FULL_TEXT" ]; then
    FULL_TEXT=$(cat "$txt")
  else
    FULL_TEXT="$FULL_TEXT $(cat "$txt")"
  fi
done

jq -n --arg t "$FULL_TEXT" --argjson dur "$DURATION_INT" --argjson n "$N" --arg p "$COMPRESSED" \
  '{text:$t, duration_seconds:$dur, silent:false, n_chunks:$n, compressed_path:$p}'

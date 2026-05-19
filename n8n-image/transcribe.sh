#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# transcribe.sh — pipeline completo de transcrição
#
# Uso:
#   /scripts/transcribe.sh <audio_file>
#
# Faz:
#   1. ffmpeg volumedetect → detecta silêncio total (gate)
#   2. ffmpeg compress + silenceremove (48kbps mono 16kHz, remove silêncios > 2s @ -30dB)
#   3. ffprobe pega duração do ORIGINAL
#   4. Se compressed > 24MB → chunka em segmentos de 25min, transcreve em paralelo
#   5. Senão → 1× chamada Whisper
#   6. Concatena transcrições ordenadas
#   7. Emite JSON em stdout: { text, duration_seconds, silent, n_chunks }
#
# Dependências (no container): ffmpeg, curl, jq
# Env: OPENAI_API_KEY
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

INPUT="${1:?uso: transcribe.sh <audio_file>}"
[ -f "$INPUT" ] || { echo "ERR input nao existe: $INPUT" >&2; exit 1; }
: "${OPENAI_API_KEY:?OPENAI_API_KEY nao definida}"

# config
SILENCE_GATE_DB="-50"           # se mean_volume < isso → silent total
SILENCEREMOVE_DB="-30dB"        # threshold pro silenceremove
SILENCEREMOVE_MIN="2"           # silencios > 2s sao removidos
BITRATE="48k"
SAMPLE_RATE="16000"
CHUNK_SECONDS="1500"            # 25 min por chunk
MAX_BYTES=$((24 * 1024 * 1024)) # 24MB margem (whisper limit 25MB)
PARALLEL=4                       # chunks em paralelo

# diretorio temp dedicado a este job
TMPDIR_JOB="$(mktemp -d -t transcribe-XXXXXX)"
trap 'rm -rf "$TMPDIR_JOB"' EXIT

log() { echo "[transcribe] $*" >&2; }

# ─── 1. detecta silencio total ─────────────────────────────────────
log "analisando volume de $INPUT"
MEAN_VOL=$(ffmpeg -i "$INPUT" -af volumedetect -vn -f null - 2>&1 \
  | grep -oE 'mean_volume: -?[0-9.]+' | head -1 | awk '{print $2}' || echo "0")
log "mean_volume=${MEAN_VOL}dB (gate=${SILENCE_GATE_DB}dB)"

# duracao do original (pra reportar mesmo se silent)
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$INPUT" 2>/dev/null || echo "0")
DURATION_INT=$(printf '%.0f' "$DURATION")

# compara: se MEAN_VOL <= SILENCE_GATE_DB, é silencio total
if awk -v v="$MEAN_VOL" -v g="$SILENCE_GATE_DB" 'BEGIN{exit !(v+0 <= g+0)}'; then
  log "SILENT (mean_vol=${MEAN_VOL} <= ${SILENCE_GATE_DB}) — pulando Whisper"
  jq -n --argjson dur "$DURATION_INT" \
    '{text:"", duration_seconds:$dur, silent:true, n_chunks:0}'
  exit 0
fi

# ─── 2. comprime + silenceremove ───────────────────────────────────
COMPRESSED="$TMPDIR_JOB/compressed.mp3"
log "comprimindo + silenceremove → $COMPRESSED"
ffmpeg -hide_banner -loglevel error -y -i "$INPUT" \
  -af "silenceremove=stop_periods=-1:stop_duration=${SILENCEREMOVE_MIN}:stop_threshold=${SILENCEREMOVE_DB}" \
  -ar "$SAMPLE_RATE" -ac 1 -b:a "$BITRATE" \
  "$COMPRESSED"

COMP_SIZE=$(stat -c%s "$COMPRESSED" 2>/dev/null || stat -f%z "$COMPRESSED")
log "tamanho comprimido=${COMP_SIZE} bytes (limite=${MAX_BYTES})"

# helper: chama whisper num arquivo, ecoa só o .text
whisper_call() {
  local file="$1"
  local resp
  resp=$(curl -sS -X POST "https://api.openai.com/v1/audio/transcriptions" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F "model=whisper-1" \
    -F "language=pt" \
    -F "response_format=json" \
    -F "file=@${file}")
  # se erro, manda stderr e retorna 1
  if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
    echo "ERR whisper: $resp" >&2
    return 1
  fi
  echo "$resp" | jq -r '.text // ""'
}

# ─── 3a. se cabe num upload só ─────────────────────────────────────
if [ "$COMP_SIZE" -le "$MAX_BYTES" ]; then
  log "single-shot Whisper"
  TEXT=$(whisper_call "$COMPRESSED")
  jq -n --arg t "$TEXT" --argjson dur "$DURATION_INT" \
    '{text:$t, duration_seconds:$dur, silent:false, n_chunks:1}'
  exit 0
fi

# ─── 3b. chunkar e processar em paralelo ───────────────────────────
log "chunking em segmentos de ${CHUNK_SECONDS}s"
CHUNK_PREFIX="$TMPDIR_JOB/chunk_"
ffmpeg -hide_banner -loglevel error -y -i "$COMPRESSED" \
  -f segment -segment_time "$CHUNK_SECONDS" \
  -c copy "${CHUNK_PREFIX}%03d.mp3"

# lista ordenada de chunks
mapfile -t CHUNKS < <(ls -1 "$TMPDIR_JOB"/chunk_*.mp3 | sort)
N=${#CHUNKS[@]}
log "n_chunks=$N — transcrevendo em paralelo (max=$PARALLEL)"

# transcreve cada chunk em paralelo, salva texto em arquivo .txt ao lado
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

# paralelismo via xargs
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

jq -n --arg t "$FULL_TEXT" --argjson dur "$DURATION_INT" --argjson n "$N" \
  '{text:$t, duration_seconds:$dur, silent:false, n_chunks:$n}'

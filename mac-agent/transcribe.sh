#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# transcribe.sh — pipeline de transcrição com diarização (roda no Mac)
#
# Uso:
#   ./transcribe.sh <audio_file>
#
# Faz:
#   1. ffmpeg volumedetect → detecta silêncio total (gate)
#   2. ffmpeg compress + silenceremove (48kbps mono 16kHz)
#   3. ffprobe pega duração do ORIGINAL
#   4. Se compressed > 24MB → chunka, transcreve em paralelo, concatena
#   5. Senão → 1× chamada gpt-4o-transcribe-diarize
#
# Output (stdout): JSON
#   { text, duration_seconds, silent, n_chunks, compressed_path, segments }
#
# segments = [{ speaker, start, end, text }, ...]
# Em chunks, start/end têm offset somado por chunk_index*CHUNK_SECONDS.
# Speaker label "A","B","C"... vindo do modelo (pode haver overlap entre chunks).
#
# Dependências: ffmpeg, ffprobe, curl, jq
# Env: OPENAI_API_KEY
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

INPUT="${1:?uso: transcribe.sh <audio_file>}"
[ -f "$INPUT" ] || { echo "ERR input não existe: $INPUT" >&2; exit 1; }
: "${OPENAI_API_KEY:?OPENAI_API_KEY não definida}"

# config
MODEL="gpt-4o-transcribe-diarize"
SILENCE_GATE_DB="-50"
SILENCEREMOVE_DB="-30dB"
SILENCEREMOVE_MIN="2"
BITRATE="48k"
SAMPLE_RATE="16000"
CHUNK_SECONDS="1200"            # 20 min/chunk — fallback se single-shot falhar
# Sem MAX_DURATION: tenta single-shot SEMPRE que o size cabe em MAX_BYTES.
# A API moderna faz chunking interno com `chunking_strategy=auto` mantendo
# consistência global de speaker labels. Se ela rejeitar (ex: "audio corrupt/unsupported"
# em arquivos próximos do limite), o fallback automático abaixo cai pro chunking manual.
MAX_BYTES=$((24 * 1024 * 1024))
PARALLEL=4

TMPDIR_JOB="$(mktemp -d -t transcribe-XXXXXX)"
log() { echo "[transcribe] $*" >&2; }

# Authorization em arquivo (modo 600) pra não vazar via `ps aux`.
# Curl lê o header de arquivo com -H @path
AUTH_FILE="$TMPDIR_JOB/.auth"
umask 077
printf 'Authorization: Bearer %s\n' "$OPENAI_API_KEY" > "$AUTH_FILE"
chmod 600 "$AUTH_FILE"

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
log "comprimido=${COMP_SIZE}B (limite=${MAX_BYTES})"

# helper: chama API, retorna JSON cru (.text + .segments)
# gpt-4o-transcribe-diarize exige chunking_strategy="auto"
transcribe_call() {
  local file="$1"
  local resp
  resp=$(curl -sS -X POST "https://api.openai.com/v1/audio/transcriptions" \
    -H "@${AUTH_FILE}" \
    -F "model=$MODEL" \
    -F "language=pt" \
    -F "response_format=diarized_json" \
    -F "chunking_strategy=auto" \
    -F "file=@${file}")
  # Se não é JSON válido, é erro (HTML/texto). Loga e falha.
  if ! echo "$resp" | jq -e . >/dev/null 2>&1; then
    echo "ERR API (resp não-JSON): $(echo "$resp" | head -c 500)" >&2
    return 1
  fi
  if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
    echo "ERR API: $resp" >&2
    return 1
  fi
  echo "$resp"
}

# ─── 3a. cabe single-shot (size E duração dentro do limite da API) ───
if [ "$COMP_SIZE" -le "$MAX_BYTES" ]; then
  log "single-shot $MODEL (dur=${DURATION_INT}s, size=${COMP_SIZE}B)"
  # Tenta single-shot; se a API rejeitar (size/duration/timeout), cai pro chunking.
  if RESP=$(transcribe_call "$COMPRESSED" 2>&1); then
    TEXT=$(echo "$RESP" | jq -r '.text // ""')
    # Filtra labels espúrios — gpt-4o-transcribe-diarize às vezes emite "@" ou
    # outros chars não-alfabéticos. Só aceita [A-Z]+ (letras puras).
    SEGMENTS=$(echo "$RESP" | jq '[.segments[]? | select((.speaker // "") | test("^[A-Z]+$")) | {speaker, start, end, text}]')
    jq -n --arg t "$TEXT" --argjson dur "$DURATION_INT" --arg p "$COMPRESSED" --argjson seg "$SEGMENTS" \
      '{text:$t, duration_seconds:$dur, silent:false, n_chunks:1, compressed_path:$p, segments:$seg}'
    exit 0
  else
    log "single-shot falhou — caindo pro chunking. erro: $(echo "$RESP" | head -c 200)"
  fi
fi

# ─── 3b. chunka + paraleliza ───────────────────────────────────────
log "chunking ${CHUNK_SECONDS}s/chunk"
CHUNK_PREFIX="$TMPDIR_JOB/chunk_"
ffmpeg -hide_banner -loglevel error -y -i "$COMPRESSED" \
  -f segment -segment_time "$CHUNK_SECONDS" \
  -c copy "${CHUNK_PREFIX}%03d.mp3"

CHUNKS=()
while IFS= read -r f; do CHUNKS+=("$f"); done < <(ls -1 "$TMPDIR_JOB"/chunk_*.mp3 | sort)
N=${#CHUNKS[@]}
log "n_chunks=$N — paralelo max=$PARALLEL"

# salva resposta JSON crua de cada chunk em .json adjacente
transcribe_chunk_to_file() {
  local chunk="$1"
  local out="${chunk%.mp3}.json"
  if transcribe_call "$chunk" > "$out"; then
    log "  ok: $(basename "$chunk")"
  else
    log "  FAIL: $(basename "$chunk")"
    return 1
  fi
}
export -f transcribe_call transcribe_chunk_to_file log
export AUTH_FILE MODEL

printf '%s\n' "${CHUNKS[@]}" | xargs -I{} -P "$PARALLEL" \
  bash -c 'transcribe_chunk_to_file "$@"' _ {}

# concatena text e segments (com offset de tempo por chunk_index)
FULL_TEXT=""
FULL_SEGMENTS="[]"
for i in "${!CHUNKS[@]}"; do
  c="${CHUNKS[$i]}"
  j="${c%.mp3}.json"
  [ -f "$j" ] || { echo "ERR chunk json faltando: $j" >&2; exit 1; }
  CHUNK_TEXT=$(jq -r '.text // ""' "$j")
  OFFSET=$((i * CHUNK_SECONDS))
  # Filtra labels espúrios (ver comentário no single-shot acima)
  CHUNK_SEGS=$(jq --argjson off "$OFFSET" \
    '[.segments[]? | select((.speaker // "") | test("^[A-Z]+$")) | {speaker, start: (.start + $off), end: (.end + $off), text}]' "$j")
  if [ -z "$FULL_TEXT" ]; then
    FULL_TEXT="$CHUNK_TEXT"
  else
    FULL_TEXT="$FULL_TEXT $CHUNK_TEXT"
  fi
  FULL_SEGMENTS=$(jq --argjson a "$FULL_SEGMENTS" --argjson b "$CHUNK_SEGS" -n '$a + $b')
done

jq -n --arg t "$FULL_TEXT" --argjson dur "$DURATION_INT" --argjson n "$N" --arg p "$COMPRESSED" --argjson seg "$FULL_SEGMENTS" \
  '{text:$t, duration_seconds:$dur, silent:false, n_chunks:$n, compressed_path:$p, segments:$seg}'

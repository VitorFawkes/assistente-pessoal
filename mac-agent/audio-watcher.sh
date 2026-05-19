#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# audio-watcher.sh
# Observa as pastas de áudio e dispara o webhook do n8n quando um
# arquivo novo aparece. Chamado pelo launchd (ver .plist).
# ─────────────────────────────────────────────────────────────────────

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Carrega .env (silencioso se não existir — vamos validar abaixo)
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

: "${WEBHOOK_URL:?WEBHOOK_URL não definida — copie .env.example para .env}"
: "${WEBHOOK_TOKEN:?WEBHOOK_TOKEN não definida}"
: "${MACBOOK_FOLDER:?MACBOOK_FOLDER não definida}"
: "${IPHONE_FOLDER:?IPHONE_FOLDER não definida}"
IPHONE_READONLY="${IPHONE_READONLY:-0}"

LOG_FILE="$SCRIPT_DIR/watcher.log"
PROCESSED_DIR="$SCRIPT_DIR/processed"
FAILED_DIR="$SCRIPT_DIR/failed"
PROCESSED_LOG="$SCRIPT_DIR/.processed.log"   # registro de arquivos já vistos (evita reenvio)

mkdir -p "$PROCESSED_DIR" "$FAILED_DIR"
touch "$PROCESSED_LOG"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE"
}

# Aguarda gravação estabilizar — tamanho não muda em 3 leituras de 1s.
wait_until_stable() {
  local file="$1"
  local prev=-1 cur=0 stable=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    [ -f "$file" ] || return 1
    cur=$(stat -f%z "$file" 2>/dev/null || echo 0)
    if [ "$cur" = "$prev" ]; then
      stable=$((stable+1))
      [ "$stable" -ge 2 ] && return 0
    else
      stable=0
    fi
    prev=$cur
    sleep 1
  done
  return 0   # se passou de 15s, manda do jeito que tá
}

# Garante que o arquivo está materializado no disco (iCloud placeholder → bytes reais).
# Estratégia robusta: copia o arquivo para um path tmp via `cp` — isso força o
# iCloud File Provider a baixar TODOS os bytes (cp lê sequencial e bloqueia até
# materializar). Verifica que o tmp final tem o mesmo size do original via stat
# E que o leitura real de bytes bate (sha256 short ou wc -c de leitura sequencial).
# Retorna o path do arquivo a usar pra upload via stdout.
#
# Uso:
#   tmp_path=$(materialize_for_upload "$file") || { log "..."; return; }
#   ...usa $tmp_path no curl...
#   rm -f "$tmp_path"
materialize_for_upload() {
  local src="$1"
  local expected
  expected=$(stat -f%z "$src" 2>/dev/null || echo 0)
  [ "$expected" -eq 0 ] && return 1

  # 1) Pede pro iCloud baixar (não-bloqueante, mas ajuda)
  if command -v brctl >/dev/null 2>&1; then
    brctl download "$src" >/dev/null 2>&1 || true
  fi

  # 2) Copia pra tmp — cp em macOS bloqueia até o iCloud finalizar download
  local ext="${src##*.}"
  local tmp
  tmp="$(mktemp -t audio-upload).${ext}"
  if ! cp "$src" "$tmp" 2>/dev/null; then
    log "ERR cp falhou em $src"
    rm -f "$tmp"
    return 1
  fi

  # 3) Confere que o tmp tem o tamanho real esperado
  local tmp_size
  tmp_size=$(stat -f%z "$tmp" 2>/dev/null || echo 0)
  if [ "$tmp_size" != "$expected" ]; then
    log "ERR tmp size ($tmp_size) != expected ($expected) — retry após 3s"
    sleep 3
    rm -f "$tmp"
    tmp="$(mktemp -t audio-upload).${ext}"
    cp "$src" "$tmp" 2>/dev/null
    tmp_size=$(stat -f%z "$tmp" 2>/dev/null || echo 0)
    if [ "$tmp_size" != "$expected" ]; then
      log "ERR tmp ainda divergente ($tmp_size vs $expected) — abortando"
      rm -f "$tmp"
      return 1
    fi
  fi

  # 4) Sanity check: leitura sequencial real pelo wc -c (não SEEK_END)
  local read_size
  read_size=$(cat "$tmp" 2>/dev/null | wc -c | tr -d ' ')
  if [ "$read_size" != "$expected" ]; then
    log "ERR leitura sequencial ($read_size) != expected ($expected)"
    rm -f "$tmp"
    return 1
  fi

  echo "$tmp"
  return 0
}

# Decide source baseado na pasta de origem.
derive_source() {
  local file="$1"
  case "$file" in
    "$MACBOOK_FOLDER"/*) echo "macbook" ;;
    "$IPHONE_FOLDER"/*)  echo "iphone" ;;
    *)                   echo "macbook" ;;
  esac
}

# Decide meeting_type pelo prefixo do nome (convenção atual: "mic - " / "online - ").
derive_meeting_type() {
  local basename
  basename="$(basename "$1")"
  case "$basename" in
    online\ -*|online_*|Online\ -*) echo "online" ;;
    mic\ -*|mic_*|Mic\ -*)          echo "presencial" ;;
    *)                              echo "desconhecido" ;;
  esac
}

# Já processado?
already_processed() {
  grep -Fxq "$1" "$PROCESSED_LOG"
}

mark_processed() {
  echo "$1" >> "$PROCESSED_LOG"
}

# Move pra processed/YYYY/MM/
move_to_processed() {
  local file="$1"
  local year month dest
  year="$(date +%Y)"
  month="$(date +%m)"
  dest="$PROCESSED_DIR/$year/$month"
  mkdir -p "$dest"
  mv "$file" "$dest/" 2>/dev/null || log "WARN não conseguiu mover $file"
}

move_to_failed() {
  local file="$1"
  mv "$file" "$FAILED_DIR/" 2>/dev/null || log "WARN não conseguiu mover $file para failed"
}

process_file() {
  local file="$1"

  # Filtra extensões de áudio
  case "$file" in
    *.mp3|*.m4a|*.wav|*.aac|*.flac|*.ogg|*.mp4) ;;
    *) return 0 ;;
  esac

  # Ignora arquivos de sistema
  case "$(basename "$file")" in
    .*|*.tmp|*.crdownload|*.part) return 0 ;;
  esac

  [ -f "$file" ] || return 0

  if already_processed "$file"; then
    log "SKIP já processado: $file"
    return 0
  fi

  log "DETECT $file"
  wait_until_stable "$file"
  [ -f "$file" ] || { log "VANISHED $file"; return 0; }

  # Materializa pra tmp (resolve iCloud placeholder) — usa o tmp pro upload
  local upload_path
  upload_path="$(materialize_for_upload "$file")"
  if [ -z "$upload_path" ] || [ ! -f "$upload_path" ]; then
    log "ERR não conseguiu materializar (iCloud?) $file"
    return 0
  fi

  local source meeting_type basename size recorded_at
  source="$(derive_source "$file")"
  meeting_type="$(derive_meeting_type "$file")"
  basename="$(basename "$file")"
  size="$(stat -f%z "$upload_path" 2>/dev/null || echo 0)"
  recorded_at="$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%SZ' "$file" 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"

  log "POST source=$source type=$meeting_type size=$size file=$basename"

  local http_code
  http_code=$(curl -sS -o "$SCRIPT_DIR/.last_response.json" -w '%{http_code}' \
    --max-time 120 \
    -X POST "$WEBHOOK_URL" \
    -H "X-Auth: $WEBHOOK_TOKEN" \
    -H "X-Source: $source" \
    -H "X-Meeting-Type: $meeting_type" \
    -H "X-Original-Filename: $basename" \
    -H "X-Recorded-At: $recorded_at" \
    -H "X-Audio-Size: $size" \
    -F "audio=@$upload_path;filename=$basename" 2>>"$LOG_FILE") || http_code="000"

  # Limpa o tmp file independente do resultado
  rm -f "$upload_path"

  # Quando IPHONE_READONLY=1 e arquivo vem do IPHONE_FOLDER, NÃO move
  # (pasta gerenciada pelo Voice Memos — mover quebraria o app).
  local readonly_src=0
  if [ "$IPHONE_READONLY" = "1" ] && [ "$source" = "iphone" ]; then
    readonly_src=1
  fi

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    log "OK http=$http_code"
    mark_processed "$file"
    [ "$readonly_src" = "1" ] || move_to_processed "$file"
  else
    log "ERR http=$http_code body=$(head -c 400 "$SCRIPT_DIR/.last_response.json" 2>/dev/null)"
    mark_processed "$file"   # evita loop de retentativa infinita
    [ "$readonly_src" = "1" ] || move_to_failed "$file"
  fi
}

# ─── Modo single-file (chamado por fswatch com um path) ─────────────
if [ "${1:-}" = "--once" ] && [ -n "${2:-}" ]; then
  process_file "$2"
  exit 0
fi

# ─── Modo daemon (fswatch monitora as duas pastas) ──────────────────
command -v fswatch >/dev/null 2>&1 || {
  log "FATAL fswatch não instalado. Rode: brew install fswatch"
  exit 1
}

mkdir -p "$MACBOOK_FOLDER" "$IPHONE_FOLDER"

log "START watching $MACBOOK_FOLDER and $IPHONE_FOLDER"

# fswatch:
#  --event Created     → só dispara quando arquivo é criado
#  --event MovedTo     → também quando arquivo é movido pra cá (Folder Action)
#  --latency 1         → batches de até 1s
#  --extended          → regex extendida no filtro
#  --include='...'     → só extensões de áudio
fswatch \
  --event Created --event MovedTo --event Renamed \
  --latency 1 \
  --extended \
  --include='\.(mp3|m4a|wav|aac|flac|ogg|mp4)$' \
  --exclude='.*' \
  "$MACBOOK_FOLDER" "$IPHONE_FOLDER" | while read -r f; do
    process_file "$f"
  done

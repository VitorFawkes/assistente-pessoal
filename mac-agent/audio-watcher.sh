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
: "${WEBHOOK_USER_ID:?WEBHOOK_USER_ID não definida — busque com: psql \"\$DATABASE_URL\" -c \"SELECT id FROM users WHERE is_admin\"}"
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

# Aguarda gravação terminar de verdade. Não basta só "lsof vazio" pq Audio
# Hijack escreve em ciclos write-flush-close-reopen — lsof entre ciclos
# retorna vazio mesmo durante gravação ativa (perdi reuniões de 24min e 15min
# por causa disso). Não basta só "size estável" pq Voice Memos fecha antes do
# fswatch ver. Combinamos: arquivo só está "terminado" se size NÃO cresceu E
# lsof vazio por STABLE_REQUIRED iterações consecutivas (cada uma de POLL segundos).
wait_until_closed() {
  local file="$1"
  local poll=5
  local stable_required=3   # 3 × 5s = 15s estável consecutivo
  local max_wait=25200      # 7h — maior que o auto-stop do AH (6h), pra esperar a
                            # gravação parar de verdade em vez de processar truncado
  local elapsed=0
  local prev_size=-1
  local stable_count=0

  while [ "$elapsed" -lt "$max_wait" ]; do
    [ -f "$file" ] || return 1
    local cur_size has_fd
    cur_size=$(stat -Lf%z "$file" 2>/dev/null || echo 0)
    if lsof -- "$file" >/dev/null 2>&1; then has_fd=1; else has_fd=0; fi

    if [ "$cur_size" = "$prev_size" ] && [ "$has_fd" = "0" ] && [ "$cur_size" -gt 0 ]; then
      stable_count=$((stable_count + 1))
      [ "$stable_count" -ge "$stable_required" ] && return 0
    else
      stable_count=0
    fi
    prev_size=$cur_size
    sleep "$poll"
    elapsed=$((elapsed + poll))
  done
  # Timeout. Pode ser gravação ainda ATIVA (AH em ciclo flush-close engana o lsof).
  # Processar agora = snapshot truncado → mp3 corrompido → "silêncio" falso. Então
  # checamos crescimento: se ainda cresce, NÃO processa (defere); senão, segue.
  local s1 s2
  s1=$(stat -Lf%z "$file" 2>/dev/null || echo 0); sleep 6
  s2=$(stat -Lf%z "$file" 2>/dev/null || echo 0)
  if [ "$s2" -gt "$s1" ]; then
    log "WARN wait_until_closed timeout (${max_wait}s) e arquivo AINDA crescendo ($s1→$s2) — DEFER (não processo): $file"
    osascript -e "display notification \"Gravação ativa há +${max_wait}s e não parou. Pare o Audio Hijack.\" with title \"Pipeline Áudio — gravação travada\" sound name \"Sosumi\"" >/dev/null 2>&1 || true
    return 2
  fi
  log "WARN wait_until_closed timeout (${max_wait}s) — arquivo estável, prosseguindo: $file"
  return 0
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
  expected=$(stat -Lf%z "$src" 2>/dev/null || echo 0)
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
  tmp_size=$(stat -Lf%z "$tmp" 2>/dev/null || echo 0)
  if [ "$tmp_size" != "$expected" ]; then
    log "ERR tmp size ($tmp_size) != expected ($expected) — retry após 3s"
    sleep 3
    rm -f "$tmp"
    tmp="$(mktemp -t audio-upload).${ext}"
    cp "$src" "$tmp" 2>/dev/null
    tmp_size=$(stat -Lf%z "$tmp" 2>/dev/null || echo 0)
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

# ─── 2.2: detecta reuniões distintas por gap de silêncio no áudio CRU ──────
# Saída: 1+ linhas "start end" (segundos). 1 linha = arquivo inteiro (sem split).
# Threshold (gap>=3min) — gap entre reuniões costuma ser silêncio real; pausa
# — partir errado é pior que colar (colado tem a UI de segmentar como rede).
GAP_SECONDS="${GAP_SECONDS:-180}"
MIN_MEETING_SECONDS="${MIN_MEETING_SECONDS:-60}"
detect_meeting_segments() {
  local f="$1" dur
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null || echo 0)
  dur=${dur%.*}
  if [ "${dur:-0}" -le 0 ]; then echo "0 0"; return 0; fi
  # Curto demais pra conter 2 reuniões + um gap → não vale a varredura.
  if [ "$dur" -lt $((GAP_SECONDS + 2 * MIN_MEETING_SECONDS)) ]; then echo "0 $dur"; return 0; fi
  local islands
  islands="$(ffmpeg -hide_banner -nostats -i "$f" -af "silencedetect=noise=-50dB:d=${GAP_SECONDS}" -f null - 2>&1 \
    | grep -oE 'silence_(start|end): [0-9.]+' \
    | awk -v dur="$dur" -v minlen="$MIN_MEETING_SECONDS" '
        BEGIN{cur=0}
        /start/{ s=$2+0; if (s-cur>=minlen) printf "%.0f %.0f\n", cur, s }
        /end/  { cur=$2+0 }
        END    { if (dur-cur>=minlen) printf "%.0f %.0f\n", cur, dur }')"
  if [ -z "$islands" ]; then echo "0 $dur"; else printf '%s\n' "$islands"; fi
}

# Transcreve UM arquivo e posta pro n8n. NÃO move/marca o original (caller faz).
# Pula POST se vazio/silencioso (não cria meeting fantasma).
transcribe_and_post() {
  local audio="$1" pbase="$2" rec="$3" src="$4" mt="$5"
  local tj te
  tj="$("$SCRIPT_DIR/transcribe.sh" "$audio" 2>>"$LOG_FILE")" && te=0 || te=$?
  if [ "$te" -ne 0 ] || [ -z "$tj" ]; then
    log "ERR transcribe.sh falhou (exit=$te) em $pbase"; return 1
  fi
  local text duration silent n_chunks compressed_path segments size
  text=$(echo "$tj" | jq -r '.text // ""')
  duration=$(echo "$tj" | jq -r '.duration_seconds // 0')
  silent=$(echo "$tj" | jq -r '.silent // false')
  n_chunks=$(echo "$tj" | jq -r '.n_chunks // 0')
  compressed_path=$(echo "$tj" | jq -r '.compressed_path // ""')
  segments=$(echo "$tj" | jq -c '.segments // []')
  [ -f "$compressed_path" ] || { log "ERR compressed_path inexistente em $pbase"; return 1; }
  if [ -z "$(printf '%s' "$text" | tr -d '[:space:]')" ]; then
    log "SKIP-EMPTY $pbase (transcrição vazia) — não posta"
    rm -rf "$(dirname "$compressed_path")" 2>/dev/null; return 0
  fi
  size="$(stat -Lf%z "$compressed_path" 2>/dev/null || echo 0)"
  log "POST source=$src type=$mt size=$size duration=${duration}s silent=$silent file=$pbase"
  local http_code
  http_code=$(curl -sS -o "$SCRIPT_DIR/.last_response.json" -w '%{http_code}' --max-time 120 \
    -X POST "$WEBHOOK_URL" \
    -H "X-Auth: $WEBHOOK_TOKEN" -H "X-User-Id: $WEBHOOK_USER_ID" \
    -H "X-Source: $src" -H "X-Meeting-Type: $mt" \
    -H "X-Original-Filename: $pbase" -H "X-Recorded-At: $rec" \
    -H "X-Audio-Size: $size" -H "X-Duration-Seconds: $duration" \
    -H "X-Silent: $silent" -H "X-N-Chunks: $n_chunks" \
    -F "audio=@$compressed_path;filename=$pbase" \
    -F "transcription=$text" -F "duration_seconds=$duration" \
    -F "silent=$silent" -F "segments=$segments" \
    2>>"$LOG_FILE") || http_code="000"
  rm -rf "$(dirname "$compressed_path")" 2>/dev/null
  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    log "OK http=$http_code ($pbase)"; return 0
  fi
  log "ERR http=$http_code ($pbase) body=$(head -c 300 "$SCRIPT_DIR/.last_response.json" 2>/dev/null)"; return 1
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
  local wclosed_rc=0
  wait_until_closed "$file" || wclosed_rc=$?
  # rc=2: gravação ainda ativa após o teto de espera — NÃO processa truncado.
  # Não marca como processado: quando a gravação parar de fato (auto-stop do AH),
  # um novo evento/relançe do watcher reprocessa o arquivo já completo.
  if [ "$wclosed_rc" = "2" ]; then
    log "DEFER $file — gravação ainda ativa, adiando (não processo truncado)"
    return 0
  fi
  [ -f "$file" ] || { log "VANISHED $file"; return 0; }

  # Safety net (2026-05-23 multi-tenant validation):
  # Copia raw pra backup local antes de processar. check-backup.sh cruza
  # com meetings no DB via cron e alerta se algo sumir. Remover quando
  # confiança no pipeline novo (~2 dias).
  backup_dir="$HOME/Documents/AudiosBackup/$(date +%Y/%m)"
  mkdir -p "$backup_dir"
  cp "$file" "$backup_dir/" 2>/dev/null && log "BACKUP $(basename "$file") → $backup_dir"

  # Materializa pra tmp (resolve iCloud placeholder)
  local materialized_path
  materialized_path="$(materialize_for_upload "$file")"
  if [ -z "$materialized_path" ] || [ ! -f "$materialized_path" ]; then
    log "ERR não conseguiu materializar (iCloud?) $file"
    return 0
  fi

  # ── 2.2: separa reuniões distintas (gap de silêncio grande no áudio cru) ──
  # Caminho normal (1 segmento) cai fora deste if e segue idêntico ao de antes.
  local seglist nseg
  seglist="$(detect_meeting_segments "$materialized_path")"
  nseg="$(printf '%s\n' "$seglist" | grep -c .)"
  if [ "${nseg:-1}" -gt 1 ]; then
    local _src _mt _rec _base _ro _i=0
    _src="$(derive_source "$file")"; _mt="$(derive_meeting_type "$file")"
    _rec="$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%SZ' "$file" 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"
    _base="$(basename "$file")"; _base="${_base%.*}"
    log "SPLIT $_base: $nseg reuniões detectadas (gap>=${GAP_SECONDS}s)"
    while read -r _st _en; do
      [ -z "$_st" ] && continue
      _i=$((_i + 1))
      local _clip="$(dirname "$materialized_path")/seg_${_i}.mp3"
      ffmpeg -hide_banner -loglevel error -ss "$_st" -to "$_en" -i "$materialized_path" \
        -ar 16000 -ac 1 -b:a 48k "$_clip" </dev/null 2>>"$LOG_FILE"
      transcribe_and_post "$_clip" "${_base} parte${_i}.mp3" "$_rec" "$_src" "$_mt"
      rm -f "$_clip"
    done <<< "$seglist"
    rm -f "$materialized_path"
    mark_processed "$file"
    _ro=0; { [ "$IPHONE_READONLY" = "1" ] && [ "$_src" = "iphone" ]; } && _ro=1
    [ "$_ro" = "1" ] || move_to_processed "$file"
    return 0
  fi

  # Transcreve localmente (compress + silenceremove + chunk se preciso + Whisper)
  log "TRANSCRIBE $(basename "$file")"
  local transcribe_json transcribe_exit
  transcribe_json="$("$SCRIPT_DIR/transcribe.sh" "$materialized_path" 2>>"$LOG_FILE")" \
    && transcribe_exit=0 || transcribe_exit=$?
  rm -f "$materialized_path"

  if [ "$transcribe_exit" -ne 0 ] || [ -z "$transcribe_json" ]; then
    log "ERR transcribe.sh falhou (exit=$transcribe_exit) — abortando $file"
    return 0
  fi

  local text duration silent n_chunks compressed_path segments
  text=$(echo "$transcribe_json" | jq -r '.text // ""')
  duration=$(echo "$transcribe_json" | jq -r '.duration_seconds // 0')
  silent=$(echo "$transcribe_json" | jq -r '.silent // false')
  n_chunks=$(echo "$transcribe_json" | jq -r '.n_chunks // 0')
  compressed_path=$(echo "$transcribe_json" | jq -r '.compressed_path // ""')
  segments=$(echo "$transcribe_json" | jq -c '.segments // []')

  if [ ! -f "$compressed_path" ]; then
    log "ERR compressed_path não existe: $compressed_path"
    return 0
  fi

  local source meeting_type basename size recorded_at
  source="$(derive_source "$file")"
  meeting_type="$(derive_meeting_type "$file")"
  basename="$(basename "$file")"
  size="$(stat -Lf%z "$compressed_path" 2>/dev/null || echo 0)"
  recorded_at="$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%SZ' "$file" 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Guarda anti-silêncio: gravação longa 100% silenciosa = provável falha de captura
  # (ex: Audio Hijack sem ACE driver, mic mutado, TCC revogada). Notifica via banner
  # macOS pra detectar ANTES de perder mais reuniões. Threshold de 60s evita ruído
  # de testes curtos e dedo escorregando no Audio Hijack.
  local dur_int=${duration%.*}
  if [ "$silent" = "true" ] && [ "${dur_int:-0}" -ge 60 ]; then
    log "ALERT silêncio digital em $basename (dur=${duration}s) — verifique captura"
    osascript -e "display notification \"Gravação de ${dur_int}s sem áudio capturado. Verifique mic/Audio Hijack.\" with title \"Pipeline Áudio — silêncio detectado\" sound name \"Sosumi\"" >/dev/null 2>&1 || true
  fi

  # 1.2: transcrição vazia (silêncio OU áudio alto sem fala — música/ruído) →
  # NÃO cria meeting fantasma no n8n. Backup já foi feito; marca e arquiva.
  if [ -z "$(printf '%s' "$text" | tr -d '[:space:]')" ]; then
    log "SKIP-EMPTY $basename (transcrição vazia) — não posta pro n8n"
    rm -rf "$(dirname "$compressed_path")" 2>/dev/null
    mark_processed "$file"
    if ! { [ "$IPHONE_READONLY" = "1" ] && [ "$source" = "iphone" ]; }; then
      move_to_processed "$file"
    fi
    return 0
  fi

  log "POST source=$source type=$meeting_type size=$size duration=${duration}s silent=$silent chunks=$n_chunks file=$basename"

  local http_code
  http_code=$(curl -sS -o "$SCRIPT_DIR/.last_response.json" -w '%{http_code}' \
    --max-time 120 \
    -X POST "$WEBHOOK_URL" \
    -H "X-Auth: $WEBHOOK_TOKEN" \
    -H "X-User-Id: $WEBHOOK_USER_ID" \
    -H "X-Source: $source" \
    -H "X-Meeting-Type: $meeting_type" \
    -H "X-Original-Filename: $basename" \
    -H "X-Recorded-At: $recorded_at" \
    -H "X-Audio-Size: $size" \
    -H "X-Duration-Seconds: $duration" \
    -H "X-Silent: $silent" \
    -H "X-N-Chunks: $n_chunks" \
    -F "audio=@$compressed_path;filename=$basename" \
    -F "transcription=$text" \
    -F "duration_seconds=$duration" \
    -F "silent=$silent" \
    -F "segments=$segments" \
    2>>"$LOG_FILE") || http_code="000"

  # Cleanup tmp dir do transcribe.sh
  rm -rf "$(dirname "$compressed_path")"

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

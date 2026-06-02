#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# audio-hijack-stop.sh
# Monitora a sessão do Audio Hijack. Se a gravação passar de AH_MAX_SECONDS,
# FORÇA a parada (Audio Hijack 4.5 não permite stop suave via AppleScript —
# só fechando o app, que finaliza a gravação). Chamado periodicamente pelo
# LaunchAgent com.vitor.audio-hijack-monitor.
#
# Modos:
#   audio-hijack-stop.sh         → monitora e, se passar do limite, força stop
#   audio-hijack-stop.sh check   → só reporta o que detecta (NÃO para nada) p/ teste
#
# Threshold ajustável: AH_MAX_SECONDS=60 audio-hijack-stop.sh check
# ─────────────────────────────────────────────────────────────────────
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG="$SCRIPT_DIR/audio-hijack-monitor.log"
MAX_SECONDS="${AH_MAX_SECONDS:-21600}"   # 6h
MODE="${1:-run}"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

# Audio Hijack está rodando?
pgrep -x "Audio Hijack" >/dev/null 2>&1 || { [ "$MODE" = "check" ] && echo "AH não está rodando"; exit 0; }

# Acha o arquivo de áudio que o AH tem aberto pra ESCRITA (gravação ativa).
# -F an: 'a'=modo de acesso (r/w/u), 'n'=nome (preserva espaços). Grava = u/w.
active_file="$(lsof -c "Audio Hijack" -F an 2>/dev/null | awk '
  /^a/ { mode = substr($0, 2) }
  /^n/ { name = substr($0, 2)
         if (mode ~ /[uw]/ && name ~ /\.(mp3|m4a|wav|aac|caf)$/) { print name; exit } }')"

if [ -z "$active_file" ]; then
  [ "$MODE" = "check" ] && echo "Nenhuma gravação ativa (AH sem arquivo de áudio aberto p/ escrita)"
  exit 0
fi

# Duração desde a criação do arquivo (birthtime) — robusto a rollover do AH e
# preservado pelo mv. Fallback: timestamp no nome "online - YYYYMMDD HHMM".
base="$(basename "$active_file")"
start_epoch="$(stat -f%B "$active_file" 2>/dev/null || echo 0)"
if [ "${start_epoch:-0}" = "0" ]; then
  ts="$(printf '%s' "$base" | grep -oE '[0-9]{8} [0-9]{4}' | head -1)"
  [ -n "$ts" ] && start_epoch="$(date -j -f "%Y%m%d %H%M" "$ts" +%s 2>/dev/null || echo 0)"
fi
if [ "${start_epoch:-0}" = "0" ]; then
  log "WARN não consegui medir início (birthtime+nome) de: $base"
  [ "$MODE" = "check" ] && echo "ativo=$base (sem como medir duração)"
  exit 0
fi
now="$(date +%s)"
elapsed=$(( now - start_epoch ))
hrs=$(( elapsed / 3600 ))

if [ "$MODE" = "check" ]; then
  echo "ativo=$base"
  echo "início=$(date -r "$start_epoch" '+%a %d %H:%M' 2>/dev/null)  elapsed=${elapsed}s (~${hrs}h)  limite=${MAX_SECONDS}s (~$((MAX_SECONDS/3600))h)"
  if [ "$elapsed" -ge "$MAX_SECONDS" ]; then echo ">>> PASSOU do limite — no modo run, fecharia o Audio Hijack agora"; else echo ">>> dentro do limite — nada a fazer"; fi
  exit 0
fi

[ "$elapsed" -lt "$MAX_SECONDS" ] && exit 0

# ── Passou do limite → força parada ──────────────────────────────────
log "STOP forçando: '$base' grava há ${elapsed}s (~${hrs}h) > limite ${MAX_SECONDS}s"

# 1) Tenta fechar suave (AH finaliza a gravação ao sair). Pode exigir TCC Automation.
osascript -e 'tell application "Audio Hijack" to quit' >/dev/null 2>&1
sleep 8

# 2) Não encerrou (diálogo de confirmação ou TCC negada) → SIGTERM
if pgrep -x "Audio Hijack" >/dev/null 2>&1; then
  log "quit não encerrou em 8s — enviando SIGTERM"
  pkill -TERM -x "Audio Hijack" 2>/dev/null
  sleep 5
  # 3) Ainda vivo → SIGKILL (mp3 é decodável mesmo sem trailer)
  if pgrep -x "Audio Hijack" >/dev/null 2>&1; then
    log "SIGTERM não encerrou — SIGKILL"
    pkill -KILL -x "Audio Hijack" 2>/dev/null
  fi
fi

if pgrep -x "Audio Hijack" >/dev/null 2>&1; then
  log "ERRO: Audio Hijack ainda rodando após todas as tentativas"
else
  log "OK Audio Hijack encerrado; gravação de ~${hrs}h finalizada"
fi

# ── Notifica (banner macOS + WhatsApp) ───────────────────────────────
osascript -e "display notification \"Fechei o Audio Hijack — a sessão gravava há ~${hrs}h.\" with title \"Auto-stop gravação\" sound name \"Sosumi\"" >/dev/null 2>&1 || true

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"; set +a
  if [ -n "${EVOLUTION_API_URL:-}" ] && [ -n "${EVOLUTION_API_KEY:-}" ] && [ -n "${EVOLUTION_INSTANCE:-}" ] && [ -n "${WHATSAPP_DESTINO:-}" ]; then
    curl -sS --max-time 15 -X POST "$EVOLUTION_API_URL/message/sendText/$EVOLUTION_INSTANCE" \
      -H "Content-Type: application/json" -H "apikey: $EVOLUTION_API_KEY" \
      -d "{\"number\":\"$WHATSAPP_DESTINO\",\"text\":\"🛑 Fechei o Audio Hijack automaticamente — a gravação estava rodando há ~${hrs}h. Ela foi finalizada e será processada normalmente.\"}" \
      >/dev/null 2>&1 || log "WARN WhatsApp falhou"
  fi
fi
log "done"

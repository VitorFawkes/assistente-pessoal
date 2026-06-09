#!/usr/bin/env bash
# Motor do VIDRO — cópia INDEPENDENTE do Mission Control.
# Porta e estado PRÓPRIOS: nunca toca em ~/.claude/command-center nem na porta 8770 (MC).
set -euo pipefail
cd "$(dirname "$0")"
PORT="${CC_PORT:-8781}"
unset ANTHROPIC_API_KEY 2>/dev/null || true   # herda o login do Claude Code (sem API key)

# Estado próprio do Vidro (NÃO compartilha state.json com o Mission Control).
VIDRO_DIR="${VIDRO_DIR:-$HOME/.claude/vidro}"
mkdir -p "$VIDRO_DIR"
export CC_STATE_FILE="${CC_STATE_FILE:-$VIDRO_DIR/state.json}"

# Restart confiável: derruba só uma instância ANTERIOR DO VIDRO nesta porta (8781). Nunca toca na 8770.
old=$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$old" ]; then
  echo "Vidro: porta $PORT ocupada (PID $old) — derrubando instância antiga do Vidro…"
  kill -TERM $old 2>/dev/null || true
  for _ in $(seq 1 20); do lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.5; done
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    kill -9 $(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null) 2>/dev/null || true
    sleep 1
  fi
fi

export CC_PORT="$PORT"
export CC_HEADLESS=1                               # nunca abre navegador — o painel é a extensão
export CC_MODEL="${CC_MODEL:-claude-opus-4-8}"     # agentes em Opus 4.8 (ajustável)
exec "$HOME/.claude/voice/.venv/bin/python" command_center.py

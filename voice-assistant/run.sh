#!/usr/bin/env bash
# Sobe o assistente de voz. Encerre falando "tchau" ou com Ctrl+C.
# Modo programador: VA_MODE=coder ./run.sh   (trabalha na pasta de onde você roda)
set -euo pipefail
ORIG_PWD="$PWD"
cd "$(dirname "$0")"

# carrega .env do projeto (se existir) sem sobrescrever o ambiente atual
if [ -f ../.env ]; then
  set -a; . ../.env; set +a
fi

# herda o login do Claude Code (sem API key separada)
unset ANTHROPIC_API_KEY 2>/dev/null || true
# pasta de trabalho = de onde você chamou (pro modo coder mexer no projeto certo)
export VA_CWD="${VA_CWD:-$ORIG_PWD}"

exec .venv/bin/python voice_loop.py

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# install.sh — instala e ativa o launchd agent do Assistente Pessoal
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.vitor.assistente-pessoal"
PLIST_SRC="$SCRIPT_DIR/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "→ Diretório do projeto: $PROJECT_DIR"

# 1) Pré-checks
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "✗ $PROJECT_DIR/.env não existe."
  echo "  Copie .env.example para .env e preencha WEBHOOK_URL / WEBHOOK_TOKEN antes de instalar."
  exit 1
fi

# 2) fswatch
if ! command -v fswatch >/dev/null 2>&1; then
  echo "→ fswatch não encontrado. Instalando via brew…"
  if ! command -v brew >/dev/null 2>&1; then
    echo "✗ brew não está instalado. Instale Homebrew primeiro: https://brew.sh"
    exit 1
  fi
  brew install fswatch
else
  echo "✓ fswatch já instalado: $(command -v fswatch)"
fi

# 3) Garante o watcher.sh executável
chmod +x "$SCRIPT_DIR/audio-watcher.sh"
echo "✓ audio-watcher.sh com permissão de execução"

# 4) Garante as pastas de áudio
set -a
# shellcheck disable=SC1091
source "$PROJECT_DIR/.env"
set +a
mkdir -p "$MACBOOK_FOLDER" "$IPHONE_FOLDER"
echo "✓ Pastas observadas existem:"
echo "    MACBOOK_FOLDER=$MACBOOK_FOLDER"
echo "    IPHONE_FOLDER=$IPHONE_FOLDER"

# 5) Renderiza o plist com o caminho absoluto do projeto
mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PLIST_SRC" > "$PLIST_DST"
echo "✓ Plist renderizado em $PLIST_DST"

# 6) (Re)carrega o agent
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "→ Agent já carregado, descarregando antes…"
  launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
fi

launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "✓ Launch agent carregado e ativo."

echo ""
echo "Status:"
launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "(state|pid|last exit code)" || true
echo ""
echo "Logs:"
echo "  cat $SCRIPT_DIR/watcher.log"
echo "  cat $SCRIPT_DIR/launchd.err.log"
echo ""
echo "Pra testar: copie um .mp3 pra $MACBOOK_FOLDER/ e veja o log em ~3-5s."

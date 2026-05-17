#!/usr/bin/env bash
# Descarrega e remove o launch agent.
set -euo pipefail

LABEL="com.vitor.assistente-pessoal"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "→ Descarregando agent…"
  launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
fi

if [ -f "$PLIST_DST" ]; then
  rm -f "$PLIST_DST"
  echo "✓ Plist removido."
fi

echo "Logs preservados em mac-agent/watcher.log e launchd.{out,err}.log"

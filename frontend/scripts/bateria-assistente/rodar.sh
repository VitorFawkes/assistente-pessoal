#!/usr/bin/env bash
# Roda a bateria do Assistente do Ações no servidor, com o código do commit atual (HEAD), banco SÓ LEITURA.
# Regra (Vitor, 02/10/2026): mexeu no Assistente (lib/agente*.ts, lib/ia.ts), roda isto antes de publicar; nota mínima 95.
#
# Uso (no Mac, dentro do repositório): bash frontend/scripts/bateria-assistente/rodar.sh [cenario1,cenario2]
# Custa uns US$ 0,20 de IA por rodada inteira e leva uns 15 minutos.
set -euo pipefail

CHAVE=${ACOES_SSH_CHAVE:-$HOME/.ssh/acoes_equipe_ed25519}
SERVIDOR=${ACOES_SERVIDOR:-root@187.127.46.139}
SO=${1:-}
SHA=$(git rev-parse --short=7 HEAD)
cd "$(git rev-parse --show-toplevel)"

echo "Montando o código $SHA no servidor (só para a bateria; nada é publicado)..."
git archive HEAD frontend | ssh -i "$CHAVE" "$SERVIDOR" "set -e
  D=/opt/acoes-equipe/src-frontend-$SHA
  rm -rf \$D && mkdir -p \$D && tar -x -C \$D --strip-components=1
  cd \$D && docker build --target builder -t acoes-equipe-ensaio:$SHA . > /opt/acoes-equipe/build-bateria-$SHA.log 2>&1"

echo "Rodando a bateria..."
# Sai com 1 se a nota ficar abaixo de 95 (a bateria decide; aqui só repassa).
ssh -i "$CHAVE" "$SERVIDOR" "umask 077
  V=\$(mktemp)
  docker exec acoes-equipe-frontend-1 env | grep -E '^(DATABASE_URL|OPENAI_API_KEY|TEAM_MODE|OWNER_SLUG|TZ)=' > \$V
  docker run --rm --env-file \$V -w /app acoes-equipe-ensaio:$SHA \
    bun scripts/bateria-assistente/bateria.ts scripts/bateria-assistente/cenarios.json '$SO' > /tmp/bateria-$SHA.jsonl 2>/dev/null
  codigo=\$?
  rm -f \$V
  grep '^{' /tmp/bateria-$SHA.jsonl
  rm -f /tmp/bateria-$SHA.jsonl
  docker rmi acoes-equipe-ensaio:$SHA > /dev/null 2>&1
  exit \$codigo"

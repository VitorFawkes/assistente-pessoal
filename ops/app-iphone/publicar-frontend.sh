#!/usr/bin/env bash
# Publica uma imagem nova do frontend do Ações da equipe sem quebrar o app do iPhone (CASE).
# Troca a imagem, espera o site responder e roda testa-app-iphone.sh; se o app quebrar,
# volta sozinho para a imagem anterior e sai 1.
# Uso (no servidor): /opt/acoes-equipe/publicar-frontend.sh acoes-equipe-frontend:<tag>
set -euo pipefail
cd /opt/acoes-equipe

NOVA=${1:?"uso: $0 acoes-equipe-frontend:<tag>"}
docker image inspect "$NOVA" >/dev/null 2>&1 || { echo "a imagem $NOVA não existe neste servidor"; exit 1; }
HOST=$(grep -o '^SITE_HOST=.*' .env | cut -d= -f2-)
HOST=${HOST:-srv2007125.hstgr.cloud}
ANTES=$(grep -o '^FRONTEND_IMAGE=.*' .env | cut -d= -f2-)
TESTE=${TESTE_APP:-./testa-app-iphone.sh}

trocar() {
  sed -i "s|^FRONTEND_IMAGE=.*|FRONTEND_IMAGE=$1|" .env
  docker compose up -d frontend >/dev/null 2>&1
  for _ in $(seq 1 60); do
    cod=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/mobile/config" || true)
    [ "$cod" = 200 ] && return 0
    sleep 2
  done
  return 1
}

cp .env ".env.antes-$(date +%Y%m%d-%H%M%S)"
echo "Publicando $NOVA (antes: $ANTES)"
if trocar "$NOVA" && "$TESTE"; then
  echo "PUBLICADO: $NOVA (app do iPhone ok)"
  exit 0
fi

echo "O APP DO IPHONE QUEBROU com $NOVA. Voltando para $ANTES."
trocar "$ANTES" || true
"$TESTE" --leve || echo "ATENÇÃO: mesmo depois de voltar, o teste do app falhou."
exit 1

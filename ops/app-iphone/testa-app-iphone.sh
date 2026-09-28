#!/usr/bin/env bash
# Imita o app do iPhone (CASE) contra o servidor do Ações da equipe e diz se ele continua funcionando.
# Roda NO servidor (/opt/acoes-equipe). Sai 0 se tudo o que o app usa responde como ele espera.
#   ./testa-app-iphone.sh          completo: também manda 2 s de silêncio e fecha a gravação
#   ./testa-app-iphone.sh --leve   sem gravação (para rodar toda hora)
# Usa a conta sintética teste-app@exemplo.invalid com um acesso temporário que some no fim.
set -uo pipefail
cd /opt/acoes-equipe

HOST=$(grep -o '^SITE_HOST=.*' .env | cut -d= -f2-)
HOST=${HOST:-srv2007125.hstgr.cloud}
BASE="https://$HOST"
LEVE=0; [ "${1:-}" = "--leve" ] && LEVE=1
TMP=$(mktemp -d)
falhas=0

ok()     { echo "  ok       $1"; }
quebrou(){ echo "  QUEBROU  $1"; falhas=$((falhas + 1)); }
web()    { curl -sS --max-time 40 --resolve "$HOST:443:127.0.0.1" "$@"; }
campo()  { python3 -c "import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
print($1)" 2>/dev/null; }
sql()    { docker exec -i acoes-equipe-voice-svc-1 python -c 'import os,sys,psycopg
c=psycopg.connect(os.environ["DATABASE_URL"]); c.autocommit=True
r=c.execute(sys.stdin.read())
l=r.fetchone() if r.description else None
print(l[0] if l else "")'; }

TOKEN=$(sql <<<"INSERT INTO sessions (user_id, user_agent) SELECT id, 'teste-app-iphone' FROM users WHERE email = 'teste-app@exemplo.invalid' AND deleted_at IS NULL RETURNING id::text")
if [ -z "$TOKEN" ]; then echo "QUEBROU: não consegui criar o acesso de teste (a conta teste-app@exemplo.invalid sumiu?)"; exit 2; fi
limpar() { sql <<<"DELETE FROM sessions WHERE id = '$TOKEN'" >/dev/null; rm -rf "$TMP"; }
trap limpar EXIT
AUTH="Authorization: Bearer $TOKEN"
echo "App do iPhone (CASE) contra $BASE"

# 1. Antes de entrar: endereço e chave do TTARS
r=$(web -w '\n%{http_code}' "$BASE/api/mobile/config"); cod=${r##*$'\n'}; corpo=${r%$'\n'*}
TTARS_URL=$(echo "$corpo" | campo 'd["ttars_url"]'); CHAVE=$(echo "$corpo" | campo 'd["ttars_chave_publica"]')
if [ "$cod" = 200 ] && [ -n "$TTARS_URL" ] && [ -n "$CHAVE" ] && echo "$corpo" | campo '(d["esqueci_senha_url"] and d["termos_url"]) or sys.exit(1)' >/dev/null; then
  ok "config (TTARS, esqueci a senha, termos)"
else
  quebrou "config: $cod $corpo"
fi

# 2. Entrar: o TTARS ainda aceita e-mail e senha (senha errada de propósito)
if [ -n "${TTARS_URL:-}" ]; then
  r=$(curl -sS --max-time 20 -w '\n%{http_code}' -X POST "$TTARS_URL/auth/v1/token?grant_type=password" \
      -H "apikey: $CHAVE" -H 'Content-Type: application/json' \
      -d '{"email":"teste-app-iphone@exemplo.invalid","password":"senha-errada-de-proposito"}')
  cod=${r##*$'\n'}; corpo=${r%$'\n'*}
  codigo=$(echo "$corpo" | campo 'd.get("error_code") or d.get("code") or ""')
  if [ "$codigo" = invalid_credentials ]; then ok "login do TTARS com e-mail e senha"; else quebrou "login do TTARS com senha: $cod $corpo"; fi
fi
cod=$(web -o /dev/null -w '%{http_code}' -X POST -H 'Authorization: Bearer invalido' "$BASE/api/mobile/entrar")
[ "$cod" = 401 ] && ok "entrar (recusa acesso inválido)" || quebrou "entrar: esperava 401, veio $cod"

# 3. Depois de entrar
r=$(web -w '\n%{http_code}' -H "$AUTH" "$BASE/api/mobile/eu"); cod=${r##*$'\n'}
[ "$cod" = 200 ] && [ -n "$(echo "${r%$'\n'*}" | campo 'd["user"]["id"] and d["user"]["nome"]')" ] && ok "eu (confere o acesso ao abrir)" || quebrou "eu: $cod"

r=$(web -w '\n%{http_code}' -H "$AUTH" "$BASE/api/mobile/meetings?limit=30"); cod=${r##*$'\n'}
if [ "$cod" = 200 ] && echo "${r%$'\n'*}" | campo 'all(m.get("id") and m.get("status") in ("processing","ready","failed","archived") for m in d["meetings"]) or sys.exit(1)' >/dev/null; then
  ok "reuniões (lista no formato do app)"
else
  quebrou "reuniões: $cod ${r%$'\n'*}"
fi

# 4. Gravar: pedaço, fim e pedaço depois do fim (o app começa gravação nova com o 409)
if [ "$LEVE" = 0 ]; then
  SILENCIO=/opt/acoes-equipe/teste-app-iphone-silencio.m4a
  if [ ! -s "$SILENCIO" ]; then
    docker exec acoes-equipe-frontend-1 ffmpeg -loglevel error -f lavfi -i anullsrc=r=44100:cl=mono -t 2 -c:a aac -b:a 64k -y /tmp/silencio.m4a \
      && docker cp acoes-equipe-frontend-1:/tmp/silencio.m4a "$SILENCIO" >/dev/null
  fi
  GID=$(python3 -c 'import uuid; print(uuid.uuid4())'); PARTE=$(date +%s%3N)
  r=$(web -w '\n%{http_code}' -X POST -H "$AUTH" -F "audio=@$SILENCIO;filename=$PARTE.m4a;type=application/octet-stream" \
      "$BASE/api/mobile/gravacao/$GID/pedaco?chunk=0&parte=$PARTE"); cod=${r##*$'\n'}
  [ "$cod" = 200 ] && [ "$(echo "${r%$'\n'*}" | campo 'd["ok"]')" = True ] && ok "gravar: pedaço subiu" || quebrou "pedaço: $cod ${r%$'\n'*}"
  r=$(web -w '\n%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{"nome":"teste do app (silencio)"}' \
      "$BASE/api/mobile/gravacao/$GID/fim"); cod=${r##*$'\n'}
  [ "$cod" = 200 ] && ok "gravar: fim da gravação" || quebrou "fim: $cod ${r%$'\n'*}"
  cod=$(web -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -F "audio=@$SILENCIO;filename=x.m4a" \
      "$BASE/api/mobile/gravacao/$GID/pedaco?chunk=1&parte=$((PARTE + 1))")
  [ "$cod" = 409 ] && ok "gravar: pedaço depois do fim dá 409" || quebrou "pedaço depois do fim: esperava 409, veio $cod"
fi

# 5. Páginas que o app abre já logado
REUNIAO=$(sql <<<"WITH u AS (SELECT id FROM users WHERE email = 'teste-app@exemplo.invalid')
  SELECT m.id::text FROM meetings m JOIN u ON m.user_id = u.id WHERE m.original_filename = 'fixture-teste-app-iphone' LIMIT 1")
if [ -z "$REUNIAO" ]; then
  REUNIAO=$(sql <<<"INSERT INTO meetings (user_id, source, original_filename, status, summary, duration_seconds, recorded_at, visibilidade)
    SELECT id, 'ios-app', 'fixture-teste-app-iphone', 'done', 'Reunião fixa do teste do app (não apagar)', 60, now(), 'so_eu'
    FROM users WHERE email = 'teste-app@exemplo.invalid' RETURNING id::text")
fi
for para in "/" "/reunioes/$REUNIAO" "/seguranca/sessoes"; do
  r=$(web -w '\n%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' -d "{\"para\":\"$para\"}" "$BASE/api/mobile/abrir")
  cod=${r##*$'\n'}; url=$(echo "${r%$'\n'*}" | campo 'd["url"]')
  if [ "$cod" != 200 ] || [ -z "$url" ]; then quebrou "abrir $para: $cod"; continue; fi
  fim=$(web -L -o /dev/null -c "$TMP/biscoito" -b "$TMP/biscoito" -w '%{http_code} %{url_effective}' "$url")
  final=${fim#* }; final=${final#"$BASE"}; final=${final%%\?*}
  if [ "${fim%% *}" != 200 ] || [ "$final" = /sem-acesso ]; then
    quebrou "página $para: ${fim%% *} em $final"
  elif [ "$para" != / ] && [ "$final" != "$para" ]; then
    quebrou "página $para foi parar em $final"
  else
    ok "página $para abre logada"
  fi
done

if [ "$falhas" = 0 ]; then echo "APP DO IPHONE OK"; exit 0; fi
echo "APP DO IPHONE QUEBRADO: $falhas problema(s)"; exit 1

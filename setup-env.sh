#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# setup-env.sh
# Lê linhas KEY=VALUE da entrada (stdin, heredoc ou arquivo) e faz merge
# no .env do projeto, criando-o a partir do .env.example se necessário.
#
# USO:
#   1) Interativo (recomendado):
#        ./setup-env.sh
#      Cole o bloco que o Cowork te enviou, depois Ctrl+D pra fechar.
#
#   2) Heredoc:
#        ./setup-env.sh <<'EOF'
#        EASYPANEL_URL=https://easypanel...
#        EASYPANEL_TOKEN=abc...
#        ...
#        EOF
#
#   3) De arquivo:
#        ./setup-env.sh < /tmp/cowork-output.txt
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"
ENV_BACKUP="$PROJECT_DIR/.env.bak.$(date +%Y%m%d_%H%M%S)"

c_dim()    { printf '\033[2m%s\033[0m\n' "$*"; }
c_ok()     { printf '\033[32m%s\033[0m\n' "$*"; }
c_warn()   { printf '\033[33m%s\033[0m\n' "$*"; }
c_err()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
c_head()   { printf '\033[1m%s\033[0m\n' "$*"; }

# ── 1) Garante que o .env existe ────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    c_ok "✓ Criei .env a partir de .env.example"
  else
    : > "$ENV_FILE"
    c_warn "⚠ .env.example não existe; criei .env vazio"
  fi
else
  cp "$ENV_FILE" "$ENV_BACKUP"
  c_dim "ℹ Backup do .env atual: $ENV_BACKUP"
fi

# ── 2) Lê input ─────────────────────────────────────────────────────
if [ -t 0 ]; then
  c_head "Cole o bloco KEY=VALUE que o Cowork te mandou e termine com Ctrl+D:"
  c_dim "(linhas em branco e comentários '#' são ignorados; aspas extras são removidas)"
  echo ""
fi

INPUT="$(cat)"

if [ -z "${INPUT//[[:space:]]/}" ]; then
  c_err "✗ Nenhum input recebido. Aborta."
  exit 1
fi

# ── 3) Helper: atualiza ou adiciona linha KEY=VALUE no .env ─────────
upsert_env() {
  local key="$1"
  local value="$2"
  local file="$3"

  # escape de '|' no value pra sed (improvável mas seguro)
  local escaped_value
  escaped_value=$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')

  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    # já existe — substitui em-place
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' -E "s|^[[:space:]]*${key}=.*|${key}=${escaped_value}|" "$file"
    else
      sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${escaped_value}|" "$file"
    fi
  else
    # não existe — adiciona ao fim
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# ── 4) Parse linha a linha e aplica ─────────────────────────────────
applied_keys=()
skipped=0

while IFS= read -r line; do
  # strip CR (caso venha do Windows)
  line="${line%$'\r'}"
  # trim espaços
  trim_line="${line#"${line%%[![:space:]]*}"}"
  trim_line="${trim_line%"${trim_line##*[![:space:]]}"}"

  # ignora vazio e comentário
  [ -z "$trim_line" ] && continue
  [[ "$trim_line" == \#* ]] && continue

  # exige KEY=VALUE
  if [[ "$trim_line" != *"="* ]]; then
    skipped=$((skipped+1))
    continue
  fi

  key="${trim_line%%=*}"
  value="${trim_line#*=}"

  # trim na key
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"

  # valida key (só A-Z, 0-9, _)
  if [[ ! "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
    skipped=$((skipped+1))
    continue
  fi

  # remove aspas externas do value (simples ou duplas)
  if [[ "$value" =~ ^\".*\"$ ]] || [[ "$value" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi

  # pula se value vazio (não sobrescrever com vazio)
  if [ -z "$value" ]; then
    skipped=$((skipped+1))
    continue
  fi

  upsert_env "$key" "$value" "$ENV_FILE"
  applied_keys+=("$key")
done <<< "$INPUT"

# ── 5) Normaliza WHATSAPP_DESTINO_ACOES → WHATSAPP_DESTINO ─────────
# (Cowork retorna a key com sufixo _ACOES; os workflows do n8n esperam sem)
v_acoes=$(grep -E '^WHATSAPP_DESTINO_ACOES=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
v_dest=$(grep -E '^WHATSAPP_DESTINO='        "$ENV_FILE" | head -1 | cut -d= -f2- || true)
if [ -n "$v_acoes" ] && [ -z "$v_dest" ]; then
  upsert_env "WHATSAPP_DESTINO" "$v_acoes" "$ENV_FILE"
  applied_keys+=("WHATSAPP_DESTINO (copiado de _ACOES)")
fi

# ── 6) Gera WEBHOOK_TOKEN se não existir ou estiver com placeholder ─
current_token=$(grep -E '^WEBHOOK_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
if [ -z "$current_token" ] || [ "$current_token" = "CHANGE_ME_TOKEN_LONGO_E_ALEATORIO" ]; then
  new_token=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n' | head -c 64)
  if [ -n "$new_token" ]; then
    upsert_env "WEBHOOK_TOKEN" "$new_token" "$ENV_FILE"
    applied_keys+=("WEBHOOK_TOKEN (auto-gerado)")
  fi
fi

# ── 7) Monta DATABASE_URL se POSTGRES_* estão preenchidos ──────────
if ! grep -qE '^DATABASE_URL=postgres://' "$ENV_FILE"; then
  pg_host=$(grep -E '^POSTGRES_HOST=' "$ENV_FILE"     | head -1 | cut -d= -f2- || true)
  pg_user=$(grep -E '^POSTGRES_USER=' "$ENV_FILE"     | head -1 | cut -d= -f2- || true)
  pg_pass=$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
  pg_db=$(grep -E '^POSTGRES_DB=' "$ENV_FILE"         | head -1 | cut -d= -f2- || true)
  pg_port=$(grep -E '^POSTGRES_PORT=' "$ENV_FILE"     | head -1 | cut -d= -f2- || true)
  pg_port="${pg_port:-5432}"
  if [ -n "$pg_host" ] && [ -n "$pg_user" ] && [ -n "$pg_pass" ] && [ -n "$pg_db" ]; then
    upsert_env "DATABASE_URL" "postgres://${pg_user}:${pg_pass}@${pg_host}:${pg_port}/${pg_db}" "$ENV_FILE"
    applied_keys+=("DATABASE_URL (montada)")
  fi
fi

# ── 8) Cria pastas observadas no Mac se ainda não existem ──────────
mac_folder=$(grep -E '^MACBOOK_FOLDER=' "$ENV_FILE"   | head -1 | cut -d= -f2- || true)
iphone_folder=$(grep -E '^IPHONE_FOLDER=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
[ -n "$mac_folder" ]    && mkdir -p "$mac_folder"
[ -n "$iphone_folder" ] && mkdir -p "$iphone_folder"

# ── 9) Resumo ──────────────────────────────────────────────────────
echo ""
c_head "─── Resumo ───"
c_ok "✓ ${#applied_keys[@]} variáveis aplicadas em .env"
for k in "${applied_keys[@]}"; do
  c_dim "    + $k"
done
[ "$skipped" -gt 0 ] && c_warn "⚠ $skipped linha(s) ignorada(s) (sem '=' ou key inválida ou value vazio)"

# Mostra .env com mascaramento de chaves sensíveis
echo ""
c_head "─── .env (com mascaramento) ───"
while IFS= read -r line; do
  if [[ "$line" == \#* ]] || [ -z "$line" ]; then
    printf '%s\n' "$line"
    continue
  fi
  k="${line%%=*}"
  v="${line#*=}"
  case "$k" in
    *TOKEN*|*KEY*|*PASSWORD*|*PASS*|*SECRET*)
      if [ -n "$v" ] && [ "${#v}" -gt 8 ]; then
        printf '%s=%s…(%d chars)\n' "$k" "${v:0:4}" "${#v}"
      else
        printf '%s=%s\n' "$k" "$v"
      fi
      ;;
    *)
      printf '%s=%s\n' "$k" "$v"
      ;;
  esac
done < "$ENV_FILE"

# ── 10) Próximos passos ───────────────────────────────────────────
echo ""
c_head "─── Próximos passos ───"

missing=()
need=(EASYPANEL_URL EASYPANEL_TOKEN EVOLUTION_API_URL EVOLUTION_API_KEY EVOLUTION_INSTANCE WHATSAPP_DESTINO)
for v in "${need[@]}"; do
  val=$(grep -E "^${v}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)
  [ -z "$val" ] && missing+=("$v")
done

if [ "${#missing[@]}" -gt 0 ]; then
  c_warn "Ainda faltam:"
  for m in "${missing[@]}"; do echo "  - $m"; done
  echo ""
  echo "Re-rode esse script com o input contendo essas chaves quando tiver elas."
else
  c_ok "✓ Todas as credenciais essenciais estão presentes."
  echo ""
  echo "Manda 'continua' no Claude que eu provisiono o easypanel e amarro tudo."
fi

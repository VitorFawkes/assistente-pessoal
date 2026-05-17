# Prompt pro Cowork (versão simplificada)

> Cole tudo entre `=====` numa nova conversa do Cowork (ou Claude com browser + filesystem).
> O Cowork vai navegar no browser, coletar as credenciais e ESCREVER direto em
> `/Users/vitorgambetti/Documents/Assistente Pessoal/.env`. Você não precisa copiar nada de volta.

```
=====
Tarefa: navegue no meu browser, colete as credenciais abaixo e SOBRESCREVA o arquivo
/Users/vitorgambetti/Documents/Assistente Pessoal/.env com o conteúdo final usando Write.

Não me peça confirmação. Trabalhe autonomamente. Se algo não der pra encontrar, deixa o valor vazio (=) e
no final me liste em 1 linha quais ficaram pendentes.

═══ O QUE COLETAR ═══

1) EASYPANEL — URL e API token
   - Abra: http://46.202.149.176:3000
   - Faça login se necessário (devo já estar logado).
   - Settings → API Tokens → Create Token "assistente-pessoal-claude" com permissão admin.
   - Copie URL base (sem barra final) e o token.

2) EVOLUTION API — URL, key, instância (já roda no mesmo easypanel)
   - Procure o serviço "evolution" / "evolution-api" / "whatsapp" no easypanel.
   - Abra → aba Domains → pegue a URL pública.
   - Abra → aba Environment → procure por AUTHENTICATION_API_KEY (ou APIKEY) e copie o valor.
   - Liste instâncias ativas: abra `<EVOLUTION_URL>/instance/fetchInstances` no browser com
     header `apikey: <a chave>` (use ModHeader ou execute via fetch no DevTools console).
     Anote o `instanceName` da instância principal.

3) WhatsApp destino — formato internacional sem +
   - Use o número do Vitor: 5511XXXXXXXXX. Se não souber, deixe vazio.

4) Frontend
   - Domínio padrão: acoes.ymnmx7.easypanel.host (se houver domínio próprio configurado no easypanel,
     prefira ele).
   - Basic Auth: user=vitor, pass=<gere uma senha forte de 24 chars: letras+números+símbolos>.

═══ O QUE ESCREVER ═══

Use a ferramenta Write pra criar/sobrescrever o arquivo exatamente neste path:
   /Users/vitorgambetti/Documents/Assistente Pessoal/.env

Com EXATAMENTE este conteúdo (substituindo os <...> pelos valores coletados):

────────────────────────────────────────────────
# Mac agent
WEBHOOK_URL=https://n8n-n8n.ymnmx7.easypanel.host/webhook/acoes-audio-ingest
WEBHOOK_TOKEN=<gere com: openssl rand -hex 32 — execute via Bash tool>
MACBOOK_FOLDER=/Users/vitorgambetti/Documents/AudiosMacbook
IPHONE_FOLDER=/Users/vitorgambetti/Documents/AudiosIphone

# Postgres (vazio por agora — será preenchido depois da provisão)
DATABASE_URL=
POSTGRES_HOST=
POSTGRES_PORT=5432
POSTGRES_DB=assistente_pessoal
POSTGRES_USER=
POSTGRES_PASSWORD=

# Evolution API
EVOLUTION_API_URL=<URL pública do evolution>
EVOLUTION_API_KEY=<AUTHENTICATION_API_KEY>
EVOLUTION_INSTANCE=<instanceName>
WHATSAPP_DESTINO=<número do Vitor sem +>

# Frontend
FRONTEND_DOMAIN=<subdomínio>
BASIC_AUTH_USER=vitor
BASIC_AUTH_PASS=<senha forte gerada>

# Easypanel
EASYPANEL_URL=<URL base do painel sem barra>
EASYPANEL_TOKEN=<token criado>
────────────────────────────────────────────────

═══ DEPOIS DE ESCREVER ═══

1) Confirme em 1 linha: "✓ .env escrito" e liste quais campos ficaram vazios (se algum).
2) NÃO mostre os valores das chaves/tokens no chat — só os nomes.
=====
```

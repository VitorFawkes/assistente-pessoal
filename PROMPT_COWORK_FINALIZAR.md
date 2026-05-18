# Prompt pro Cowork — finalizar setup do Assistente Pessoal

> Cole tudo entre `=====` no Cowork. Ele faz 4 coisas em sequência: 1) mount no n8n, 2) source/build do frontend, 3) Basic Auth, 4) DNS.

```
=====
Tarefa: finalizar o setup do projeto Assistente Pessoal no easypanel + DNS.

Trabalhe autonomamente. NÃO me peça confirmação. Se algo travar, me reporta com o passo exato e o erro visto.

═══ CONTEXTO ═══

- Easypanel: http://46.202.149.176:3000 (já estou logado)
- Projeto easypanel: `n8n`
- 2 serviços envolvidos:
  - `n8n` (já existe, rodando — precisa só adicionar 1 mount)
  - `assistente-frontend` (criado, vazio — precisa source + mount + Basic Auth)
- Repo GitHub: https://github.com/VitorFawkes/assistente-pessoal (privado)
- Domínio alvo: acoes.vitorgambetti.com.br (precisa A-record)

═══ TAREFA 1 — Adicionar mount `audios` no serviço n8n ═══

1. Abre http://46.202.149.176:3000
2. Clica no projeto **n8n**
3. Clica no serviço **n8n**
4. Vai pra aba **Mounts**
5. Clica em **+ Add Mount**
6. Preenche:
   - Type: **Volume**
   - Name: **audios**
   - Mount Path: **/audios**
7. Salva
8. Clica no botão **Deploy** (vai aparecer aviso "service has pending changes" — clica pra aplicar)
9. Aguarda status voltar pra "Running"/"Healthy" (~30-60s)

═══ TAREFA 2 — Configurar source do `assistente-frontend` via GitHub ═══

1. Ainda no projeto n8n, clica no serviço **assistente-frontend**
2. Vai pra aba **Source** (ou "General" / "Build" — onde define a origem do código)
3. Type: **Git** (ou "GitHub" se for a opção direta)
4. Se o easypanel pedir pra conectar GitHub:
   a. Clica em **Connect GitHub** ou similar
   b. Autoriza o easypanel a acessar o repo `VitorFawkes/assistente-pessoal` (privado)
   c. Pode pedir pra instalar o easypanel app no GitHub — autoriza
5. Configurações do Git:
   - **Repository**: VitorFawkes/assistente-pessoal
   - **Branch**: main
   - **Build Path** (ou "Root Directory" / "Subpath"): **frontend**  ← IMPORTANTE: subdir, não a raiz
   - **Auto Deploy on Push**: ON
6. Build settings:
   - Build type: **Dockerfile** (o subdir frontend/ já tem um Dockerfile)
   - Dockerfile Path: **Dockerfile** (relativo ao build path)
7. Salva
8. Adiciona mount `audios` no assistente-frontend também:
   - Aba **Mounts** → + Add Mount
   - Type: Volume, Name: **audios**, Mount Path: **/audios**
9. Clica em **Deploy** pra disparar o primeiro build

═══ TAREFA 3 — Basic Auth no domínio `acoes.vitorgambetti.com.br` ═══

1. No serviço assistente-frontend, vai pra aba **Domains**
   (já tem o domínio `acoes.vitorgambetti.com.br` configurado apontando pra porta 3000)
2. Clica/edita esse domínio
3. Procura por **Middlewares** ou **Basic Auth** ou **HTTP Auth**
4. Adiciona um middleware Basic Auth com:
   - User: **vitor**
   - Pass: olha o arquivo `/Users/vitorgambetti/Documents/Assistente Pessoal/.env` na chave BASIC_AUTH_PASS (se precisar, pede pro Vitor)
5. Salva

OBS: Se o easypanel não suportar Basic Auth nativo no proxy via UI, pula essa task e me reporta — vou implementar auth no app diretamente.

═══ TAREFA 4 — DNS A-record pra `acoes.vitorgambetti.com.br` ═══

Hoje `acoes.vitorgambetti.com.br` não resolve. Precisa apontar pra `46.202.149.176`.

Os nameservers são `ns1.dns-parking.com` / `ns2.dns-parking.com`. Esse é um setup parking, então o DNS pode estar no painel do registrador (Hostinger ou Namecheap ou similar) ou em outro provider.

1. Abra estas URLs em abas separadas pra descobrir onde está o DNS:
   - https://hpanel.hostinger.com.br/  (Hostinger)
   - https://www.namecheap.com/myaccount/login  (Namecheap)
   - https://dash.cloudflare.com/  (Cloudflare — se houver conta)
   - https://registro.br/  (Registro.br — se for .br BR registrado lá)
2. Faça login em qualquer um que tenha o domínio `vitorgambetti.com.br`
3. Vá pra **DNS** / **Zona DNS** / **Manage DNS**
4. Adicione um **A record**:
   - Type: **A**
   - Name/Host: **acoes** (sem `.vitorgambetti.com.br` — só `acoes`)
   - Value/Points to: **46.202.149.176**
   - TTL: **3600** (ou padrão)
5. Salva

Valida: `dig +short A acoes.vitorgambetti.com.br` deve retornar `46.202.149.176` (pode demorar 5-30min pra propagar).

═══ ME REPORTAR ═══

Responde com checklist:
- [ ] Tarefa 1: mount no n8n + deploy OK
- [ ] Tarefa 2: GitHub conectado + source apontando pra `frontend/` + mount no FE + build iniciou
- [ ] Tarefa 3: Basic Auth configurado (ou: "easypanel não suporta nativamente, pulou")
- [ ] Tarefa 4: A-record criado em [provider] (e em quanto tempo deve propagar)

Pra cada problema, me dá: passo onde travou + screenshot ou erro literal.
=====
```

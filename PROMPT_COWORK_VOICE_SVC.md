# Prompt pro Cowork — provisionar voice-svc (via GHCR)

> Cole tudo entre `=====` no Cowork. 3 tarefas em sequência. **Trabalhe autonomamente, não pede confirmação a cada passo. Se travar, reporta o passo + erro literal.**

```
=====
Tarefa: provisionar o microservice `voice-svc` no easypanel apontando pra
uma imagem Docker pré-buildada no GitHub Container Registry (NÃO buildar
no easypanel — tentei antes e foi desastre, comeu CPU 100%).

O workflow n8n `Acoes - Audio Ingest` já foi atualizado pra chamar o
voice-svc após cada reunião processada — só falta o voice-svc existir.

═══ CONTEXTO ═══

- Easypanel: http://46.202.149.176:3000 (Vitor já logado)
- Projeto easypanel: `n8n`
- GitHub repo: VitorFawkes/assistente-pessoal (privado)
- GitHub Actions workflow já configurado em .github/workflows/voice-svc.yml
  builda automaticamente ao detectar push em voice-svc/**

═══ TAREFA 1 — Tornar imagem GHCR pública ═══

O GitHub Actions já está buildando a imagem em
`ghcr.io/vitorfawkes/assistente-pessoal-voice-svc:latest`. O package herda
visibility do repo (privado), então precisa ser tornado público pra
easypanel poder pull sem credenciais.

1. Abrir https://github.com/VitorFawkes/assistente-pessoal/actions
   - Procurar runs do workflow "voice-svc image"
   - Aguardar o último estar **Success** (~10 min no primeiro build)
   - Se falhar, copia as últimas 30 linhas do log e me reporta

2. Quando o build estiver Success:
   - Abre https://github.com/users/VitorFawkes/packages
   - Clica no package `assistente-pessoal-voice-svc`
   - Clica em **Package settings** (botão "Manage package" no canto direito)
   - Rola até **Danger Zone** → "Change package visibility"
   - Muda pra **Public**
   - Confirma digitando o nome do package se pedir

3. Verifica que ficou público:
   `docker pull ghcr.io/vitorfawkes/assistente-pessoal-voice-svc:latest`
   (não precisa estar logado se for público)
   Reporta se deu certo ou erro.

═══ TAREFA 2 — Criar service voice-svc no easypanel ═══

CRÍTICO: configurar TUDO de uma vez (source + env + mounts + port) antes
do primeiro deploy. Não é pra ir clicando deploy entre os passos — quando
configurar parte e salvar, outras configs podem ser resetadas.

1. Abre http://46.202.149.176:3000 → projeto **n8n**
2. **+ Create Service** → tipo **App** → nome: `voice-svc` → Create

3. Aba **Source** (ou General/Build):
   - Type: **Docker Image** (NÃO Git/GitHub)
   - Image: `ghcr.io/vitorfawkes/assistente-pessoal-voice-svc:latest`
   - Username/Password: deixa vazio (imagem pública)

4. Aba **Environment**: cola exatamente isso (uma var por linha):
   ```
   DATABASE_URL=postgres://assistente:bd73f6392c1f72ed0283ea8261d0372c@n8n_assistente-pessoal-db:5432/assistente_pessoal
   AUDIO_BASE=/audios
   PYTHONUNBUFFERED=1
   ```

5. Aba **Mounts** → **+ Add Mount**:
   - Type: **Volume**
   - Name: `audios`
   - Mount Path: `/audios`

6. Aba **Ports** (ou Service Port / Internal Port):
   - Container Port: **8000**
   - Protocol: HTTP
   - **Sem domínio público** (só DNS interno — não adiciona em Domains)

7. Aba **Resources** (se existir):
   - Memory: pelo menos **2 GB** (torch + speechbrain precisam)
   - CPU: 1 vCPU

8. Aba **Deploy**:
   - Replicas: 1
   - Healthcheck (se opção existir): GET `/health`, interval 30s

9. **AGORA SIM**: clica em **Deploy** (botão verde no topo da página).

10. Acompanha logs:
    - Aba **Deployments** → último deploy → Logs
    - Deve aparecer `INFO: Uvicorn running on http://0.0.0.0:8000`
    - Ou erro: copia últimas 40 linhas e me reporta.
    - Primeira request real demora ~10s (download lazy do modelo SpeechBrain
      do HuggingFace).

═══ TAREFA 3 — Validar end-to-end ═══

Do navegador (sem basic auth):

https://n8n-assistente-frontend.tatetz.easypanel.host/api/voice-svc/health

Deve retornar JSON com `"winner": "http://voice-svc:8000"` e dentro do
`results` ter um item com `"ok": true` + body com info do modelo.

Se `winner` for `null`:
- Cola a saída inteira
- Cola logs do voice-svc (aba Logs no easypanel, últimas 40 linhas)

═══ ME REPORTAR ═══

Checklist:
- [ ] Tarefa 1: GHCR package público — `docker pull` funcionou
- [ ] Tarefa 2: voice-svc criado, deploy OK, logs mostram uvicorn running
- [ ] Tarefa 3: `/api/voice-svc/health` retornou `winner` não-null

Pra cada problema: passo onde travou + erro literal/screenshot.

Se tudo verde, manda print da página /reunioes/[id] (qualquer ID) no
frontend mostrando os chips de speaker (UI já tem botão "identificar por
voz" e badge de confidence — quero ver visualmente).
=====
```

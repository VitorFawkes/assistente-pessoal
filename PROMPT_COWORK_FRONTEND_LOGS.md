# Prompt pro Cowork — pegar build logs do frontend

> Use só se eu te avisar que o frontend continua 404 após o deploy. Cola entre `=====` no Cowork.

```
=====
Tarefa: pegar os logs do build/deploy do serviço `assistente-frontend` no easypanel pra eu debugar por que não está respondendo (404 do Traefik).

Easypanel: http://46.202.149.176:3000 (já logado)

═══ Passos ═══

1) Vai em projeto **n8n** → serviço **assistente-frontend**

2) Procura a aba **Deployments** (lista de deploys recentes)
   - Pega o último deploy
   - Status: "Success" / "Failed" / "Building" / "Crashed"?

3) Se o último deploy aparecer como **Failed**:
   - Clica nele pra abrir os logs do build
   - Me copia as últimas ~50 linhas (especialmente as que mostram "ERROR" ou "exit code")

4) Se o deploy aparece como **Success** mas Traefik retorna 404:
   - Vai pra aba **Logs** (runtime logs, não build logs)
   - Me copia as últimas ~50 linhas do container
   - Procura por:
     * "EADDRINUSE" (porta ocupada)
     * "Module not found"
     * "next: not found"
     * "Error: Cannot find module"
     * "DATABASE_URL"

5) Tira screenshot OU me copia o conteúdo:
   - Da aba **General** mostrando o status do serviço
   - Da aba **Mounts** confirmando que tem `audios:/audios`
   - Da aba **Source** confirmando `VitorFawkes/assistente-pessoal`, branch `main`, path `/frontend`

═══ Me reportar ═══

- Último deploy: success/failed/building
- Trecho relevante dos logs
- Status do container atual
=====
```

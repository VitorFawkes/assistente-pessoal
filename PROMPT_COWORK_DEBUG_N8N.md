# Prompt pro Cowork — debug urgente n8n

> O n8n parou de responder após o deploy do mount. Cola tudo entre `=====` no Cowork.

```
=====
Tarefa URGENTE: o serviço n8n no easypanel está retornando 404 pro Traefik. Preciso descobrir o que aconteceu.

Easypanel: http://46.202.149.176:3000 (já logado)
Projeto: n8n  
Serviço afetado: n8n (que normalmente serve https://n8n.vitorgambetti.com.br)

Sintoma: qualquer requisição pra https://n8n.vitorgambetti.com.br retorna "404 page not found" do Traefik (não do n8n). Os domínios estão configurados corretamente no inspect, mas o roteamento não pega.

═══ Passos ═══

1) Abra o easypanel → projeto **n8n** → serviço **n8n**

2) Tira screenshot OU me copia o conteúdo do **Deployment status** / **Container status**:
   - Está "Running" / "Healthy" / "Failed" / "Pending"?
   - Quantas réplicas estão UP?

3) Vai pra aba **Logs** ou **Deployment Logs** do serviço n8n
   - Pega as últimas ~50 linhas
   - Procura especificamente por:
     * "Error", "Permission denied", "Cannot find"
     * Algo relacionado a "/audios" (mount novo que adicionamos)
     * Algo relacionado a "/home/node/.n8n"
   - Me copia trechos relevantes

4) Verifica a aba **Mounts** do serviço n8n:
   - Confirma que tem 2 mounts:
     * `volume data → /home/node/.n8n`
     * `volume audios → /audios`
   - Confirma que ambos estão presentes (nenhum sumiu)

5) Verifica a aba **Domains** do serviço n8n:
   - Confirma que existem os domínios:
     * `n8n-n8n.tatetz.easypanel.host` → port 5678
     * `n8n.vitorgambetti.com.br` → port 5678
   - Se algum tem middleware atribuído, REMOVE (só o `assistente-frontend` deveria ter middleware basic auth)

6) Se o container está com erro: clique em **Redeploy** / **Restart**.
   - Se preferir, REMOVA temporariamente o mount `audios:/audios` (suspeito que ele esteja causando problema), redeploy, confirma que n8n volta. Depois readiciona o mount.

═══ Me reportar ═══

- Status do container: "Running" / "Restart loop" / "Failed" / "Pending"
- Últimas 30 linhas do log (especialmente as primeiras linhas de erro)
- Mounts atuais (literal)
- Se você removeu o mount audios pra testar e n8n voltou: avisa
=====
```

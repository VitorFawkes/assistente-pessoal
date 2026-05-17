# Prompt pro Cowork — adicionar volume `audios` no serviço n8n

> Cole tudo entre `=====` no Cowork. Ele faz no painel do easypanel e me confirma.

```
=====
Tarefa: adicionar um Mount (volume persistente) no serviço n8n do easypanel.

Não me peça confirmação. Trabalhe autonomamente.

═══ ACESSO ═══

URL do easypanel: http://46.202.149.176:3000
(Eu já estou logado.)

═══ PASSO A PASSO ═══

1) Abra http://46.202.149.176:3000

2) Na home, clique no projeto chamado **n8n**.

3) Dentro do projeto, clique no serviço chamado **n8n** (não "evolution-api", não "postgres" — o serviço chamado n8n mesmo).

4) Procure a aba/seção chamada **Mounts** (pode estar como "Volumes" ou "Storage" também — é onde já tem 1 mount listado com `type: Volume, name: data, mountPath: /home/node/.n8n`).

5) Clique em **+ Add Mount** (ou "+ Add Volume" / botão equivalente).

6) Preencha o novo mount:
   - **Type**: `Volume` (selecione no dropdown — não bind nem file)
   - **Name**: `audios`
   - **Mount Path**: `/audios`

7) Clique em **Save** / **Confirm** pra adicionar o mount à configuração.

8) Volte pra aba principal do serviço n8n. Vai aparecer um aviso "service has pending changes" ou similar, com um botão **Deploy**.

9) Clique em **Deploy** pra aplicar a mudança. Isso causa um restart do n8n (~30s de downtime).

10) Aguarde o status voltar pra "Running" / "Healthy" (luz verde, ou status "deployed").

═══ VALIDAÇÃO ═══

Depois do deploy, confira no inspect via API:

curl -s "http://46.202.149.176:3000/api/trpc/services.app.inspectService?input=%7B%22json%22%3A%7B%22projectName%22%3A%22n8n%22%2C%22serviceName%22%3A%22n8n%22%7D%7D" -H "Authorization: Bearer da53..." | grep -o '"mounts":\[[^]]*\]'

Deve aparecer 2 mounts: `data` (existente) e `audios` (novo).

═══ ME RETORNAR ═══

Responda com:
- "✓ mount audios adicionado ao n8n e deploy concluído" se tudo deu certo
- "✗ erro: [descrição]" se algo travou
- "⚠ aviso: [descrição]" se notar algo estranho (ex: precisou de mais um passo, deploy demorou demais, etc.)

NÃO precisa devolver tokens nem credenciais — eu já tenho.
=====
```

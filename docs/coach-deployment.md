# Coach — publicação e operação privada

Procedimento preparado em 2026-09-20. Esta preparação não aplica migration, não publica imagem, não ativa perfil de usuário e não chama o modelo.

## Validação executada em 2026-09-20

- Build de produção, TypeScript e lint dos arquivos alterados passaram.
- 210 testes unitários passaram; testes de banco/provedor rodam separadamente, por opção explícita.
- 11 testes com Postgres real passaram, com 99 verificações de isolamento, concorrência, repetição, cobertura acima de 100 registros, correções e exclusão.
- 9 testes dos runners passaram, sem acessar produção.
- Uma prova com o provedor real passou: análise de reunião fictícia, revisão com evidências, conversa contextual e persistência (20 verificações). Nenhuma transcrição pessoal foi usada nessa prova.
- Navegador: desktop e 390px, edição/correção/rejeição de memória, configurações, pausa/retomada, recarga, chat, revisão e links de evidência verificados. Sem rolagem horizontal no celular.
- HTTP local: acesso sem sessão redireciona; cron sem token retorna 401; origem indevida retorna 403; escrita em memória de outro usuário retorna 404.
- Backup privado anterior à publicação criado no próprio VPS com permissão 0600. Conteúdo e credenciais ficam fora deste repositório.

Revisão de código: corrigidos publicação de revisão incompleta, atribuição de fala sem identificação, remapeamento incorreto de evidências, contexto antigo após edição da fonte, corrida ao desativar rotina semanal e orçamento de tempo do runner. Citações de análises, chat e revisão são selecionadas por IDs de fontes previamente verificadas.

Estes testes comprovam os fluxos técnicos exercitados, não eficácia longitudinal de desenvolvimento profissional. A publicação e a análise do histórico real são etapas distintas.

## Estado verificado em leitura

- Repositório `VitorFawkes/assistente-pessoal`, público, branch padrão `main`; credencial GitHub existente com permissão de leitura e push.
- Serviço frontend `n8n_assistente-frontend`, réplica `1/1`, imagem anterior `ghcr.io/vitorfawkes/assistente-pessoal-frontend:4b0962f649cbc25fa4736108df78279192f97f71`.
- A source armazenada no Easypanel ainda apontava para `:latest`, diferente da imagem imutável em execução. Corrigir ambas as referências na publicação.
- Serviço Postgres `n8n_assistente-pessoal-db`, `postgres:17`, réplica `1/1`.
- Tanto [domínio Ações](https://acoes.vitorgambetti.com.br/) quanto [domínio Easypanel](https://n8n-assistente-frontend.tatetz.easypanel.host/) responderam `200` após redirecionar à página de acesso. A antiga nota de `404` para o primeiro domínio está desatualizada.
- `OPENAI_API_KEY` presente no serviço. `COACH_CRON_TOKEN` ausente antes desta implementação. Nenhuma chave foi registrada neste documento.
- Cron ativo no VPS; Python 3 e suporte a locks de arquivo disponíveis. Uma rotina existente de recuperação de reuniões foi preservada; não havia rotina coach.
- Host com 1 CPU e aproximadamente 3,82 GiB de RAM. O processamento inicial deve ser sequencial, em lotes pequenos. Latência de rede/modelo não justifica abrir concorrência ilimitada.

Não gravar transcrições, títulos de reuniões, mensagens do coach, nomes de participantes, snapshots de env ou tokens neste repositório público. Artefatos de validação com contexto privado ficam em diretório temporário com permissão `0600`, fora do git.

## Ferramentas locais

`ops/coach-remote.py` usa as credenciais `VPS_*` já existentes na `.env`, passando a senha pelo ambiente do subprocesso `sshpass`, sem colocá-la em argumentos ou logs. Exige um host previamente confiado em `known_hosts`; não desabilita essa proteção. Exemplo somente leitura:

```sh
python3 ops/coach-remote.py --command 'docker service ls'
```

Para enviar um arquivo privado sem imprimir seu conteúdo, use `--stdin-file`; para guardar resposta privada, use `--output-file /tmp/nome-do-arquivo`. O helper não torna um comando arbitrário seguro: a operação remota deve ser revisada antes da execução.

`ops/coach-easypanel.py` lê o serviço e, por padrão, apenas informa mudanças planejadas. A aplicação precisa do argumento explícito `--apply` e de um `--snapshot-file` novo, para backup privado. Ele mantém as demais linhas de env, `dotEnvPath`, credenciais de registry e source persistente. Não dispara deploy.

Os endpoints conferidos no backend da instalação são:

- Leitura: `GET services.app.inspectService`, entrada `{"json":{"projectName":"n8n","serviceName":"assistente-frontend"}}`; resposta `{ "json": { ...serviço... } }`.
- Atualização: `POST services.app.updateEnv`, com env completo e `dotEnvPath` quando presente.
- Imagem: `POST services.app.updateSourceImage`, com imagem e credenciais de registry preservadas.

O prefixo é `/api/trpc/`. Atualizar apenas `docker service update --image` deixa a configuração armazenada no Easypanel antiga; alinhar a source persistente antes do deploy.

## Ordem da publicação

1. Validar migration em banco isolado com schema atual e sem linhas de produção; executar isolamento RLS, contratos do coach, build e testes de interface.
2. Produzir imagem com tag imutável correspondente ao commit testado. Confirmar conclusão do workflow GitHub e disponibilidade da imagem.
3. Salvar snapshot privado do serviço e backup de banco apropriado antes de aplicar a migration aditiva. Aplicar com `ON_ERROR_STOP`; conferir tabelas, RLS e grants usando os papéis reais.
4. Gerar um token dedicado com pelo menos 32 bytes aleatórios. Guardar apenas no env do serviço, no arquivo privado do runner e, temporariamente, em arquivo `0600` fora do git. Não reutilizar tokens do n8n, webhook ou agente de tarefas.
5. Preparar a atualização preservando todo o env:

   ```sh
   python3 ops/coach-easypanel.py \
     --token-file /tmp/acoes-coach-token \
     --image ghcr.io/vitorfawkes/assistente-pessoal-frontend:COMMIT_SHA
   ```

6. Após revisar as mudanças, acrescentar `--apply --snapshot-file /tmp/acoes-coach-service-before.json`. Publicar pelo mecanismo habitual do Easypanel e conferir que a imagem efetiva coincide com a tag testada. `COMMIT_SHA` deve ser substituído por um SHA hexadecimal real de 40 caracteres.
7. Antes de ativar processamento, conferir que o endpoint rejeita token ausente/incorreto. Confirmar autenticação, privacidade e leitura da interface. Somente o perfil autorizado deve ficar ativado.
8. Instalar runner e validar configuração. Executar uma rodada autenticada controlada, verificar persistência e fontes na interface e então instalar cron. A rotina não envia mensagens por WhatsApp, email ou canais externos.

## Runner e cron

Instalar os arquivos em diretório de propriedade root:

```text
/opt/acoes-coach/coach-run.py                 root:root 0755
/opt/acoes-coach/coach-backfill.py            root:root 0755
/etc/acoes-coach/                            root:root 0700
/etc/acoes-coach/runner.json                 root:root 0600
/etc/cron.d/acoes-coach                      root:root 0644
/etc/logrotate.d/acoes-coach                 root:root 0644
/var/log/acoes-coach.log                     root:root 0600
```

Conteúdo conceitual de `runner.json` — substituir o marcador por segredo real sem imprimi-lo:

```json
{
  "url": "https://acoes.vitorgambetti.com.br/api/internal/coach/run",
  "token": "TOKEN_ALEATORIO_DEDICADO",
  "timeout_seconds": 600
}
```

O runner rejeita arquivo acessível por grupo/outros, owner diferente, HTTP sem TLS, URL com query/credenciais, token fraco e redirecionamento. Usa `Authorization: Bearer`, POST vazio, sem `user_id`. O servidor identifica somente usuários com coach ativado. Credenciais nunca entram na linha de comando.

`--check` valida sem rede:

```sh
python3 /opt/acoes-coach/coach-run.py --check
```

Copiar os modelos `ops/coach-cron.example` e `ops/coach-logrotate.example` para os destinos acima. O cron roda a cada 15 minutos. O lock `/run/lock/acoes-coach.lock` impede sobreposição entre cron e backfill. As mensagens de log contêm apenas status/HTTP/classe de erro, nunca corpo da resposta, IDs de usuários ou trechos de reunião. O runner não faz retry automático; a próxima rodada usa a idempotência e os leases do servidor.

## Backfill inicial

O inventário agregado do acervo autorizado mostrou volume suficiente para que a execução exclusiva a cada 15 minutos demore mais de um dia com dois chunks por chamada. Os números detalhados do acervo pessoal ficam fora deste repositório público. `ceil(caracteres / 24000)` é uma aproximação: cortes por linha e unidades UTF-16 podem elevar a contagem real.

`ops/coach-backfill.py` oferece uma execução explícita, sequencial, com dois chunks por usuário por chamada conforme o limite do servidor, pausa de cinco segundos e limites de tempo/ticks. Não instala agendamento. O endpoint deve responder `ok: true` e o contador agregado `remaining_meetings`; ausência desse contador interrompe a execução em vez de entrar em loop.

```sh
python3 /opt/acoes-coach/coach-backfill.py --max-ticks 250 --max-seconds 14400
```

O processo para em pendência zero, erro, limite de ticks ou limite de tempo. Exit `0` indica conclusão, `1` erro e `2` limite com trabalho ainda pendente. Em reinício, análises persistidas não devem ser cobradas/processadas novamente; a garantia vem da idempotência do backend. Conferir cobertura real depois, porque novas reuniões ou correções podem criar pendências.

## Verificação e retorno seguro

- Confirmar persistência de conversa, memória corrigida e revisão após reload; conferir exemplos nas transcrições autorizadas.
- Inspecionar uma execução agendada real, a data `last_run_at` e o estado do log, sem expor seu conteúdo privado em artefatos públicos.
- Testar isolamento com tenant sintético sem dados pessoais.
- Para pausar a rotina, remover o arquivo exclusivo `/etc/cron.d/acoes-coach`; manter outros crons. O perfil do usuário também permite pausar o coach.
- Para reverter frontend, restaurar a imagem anterior no Easypanel e republicar, preservando os demais envs. Não remover tabelas do coach como rollback de emergência; isso destruiria memória já criada.
- Se ocorrer vazamento do token, substituí-lo nos dois destinos. Não é necessário rotacionar credenciais não relacionadas.

Testes locais do runner: `python3 ops/coach-run.test.py`. Eles não acessam produção nem chamam provedores de IA.

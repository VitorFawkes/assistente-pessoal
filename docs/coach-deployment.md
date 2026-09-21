# Coach — publicação e operação privada

## Orientação guiada — primeira publicação em 21/09/2026

Imagem `690f93f8f179b0e49a05334041b7caf351b04abd`, integrada pelo [PR #7](https://github.com/VitorFawkes/assistente-pessoal/pull/7) e confirmada em execução às 19h14 de São Paulo. Source persistente e container foram alinhados; ambiente e credenciais preservados por comparação com snapshot privado. O propósito de um bloco estratégico, explicitamente confirmado pelo usuário, foi acrescentado ao seu contexto sem alterar os demais campos do perfil. Modelo Sol e rotinas existentes preservados.

Validação desta primeira versão: 404 testes unitários, 48 testes de Postgres, 10 de runners, TypeScript, lint, build e 24 verificações de navegador sintético na [CI](https://github.com/VitorFawkes/assistente-pessoal/actions/runs/35661250813). A [imagem](https://github.com/VitorFawkes/assistente-pessoal/actions/runs/35661410832) foi gerada a partir do SHA integrado. Com Sol, passaram as 22 regressões existentes, 12 casos novos e a sequência cumulativa de cinco turnos reexecutada após corrigir recibo de conclusão e limite de perguntas; não se trata de uma única rodada com todos os cenários.

Em produção, a conversa original concluiu e persistiu em uma tentativa. Passaram 23 verificações de autenticação, configurações, persistência, navegação e interface. A leitura humana, porém, encontrou contribuição ainda genérica: o coach explicou melhor seu papel, mas adiou a comparação concreta. Portanto, esse resultado **não comprova a resolução completa do problema de qualidade**.

O refinamento descrito em `docs/coach-guided-quality.md` está preparado e ainda não publicado. Seu teste negativo passou; a geração do cenário novo precisa ser concluída antes da liberação. Logs, respostas, consultas e capturas com contexto pessoal ficam em arquivos privados fora do repositório.

## Coach pessoal publicado e rotinas ativas — 21/09/2026

Estado confirmado às 17h53 de São Paulo: [coach em produção](https://acoes.vitorgambetti.com.br/coach), imagem `329535b2d4bf970cd59ef3ff251f35abbeab6369`, integrada pelo [PR #6](https://github.com/VitorFawkes/assistente-pessoal/pull/6). A [CI final](https://github.com/VitorFawkes/assistente-pessoal/actions/runs/35652838207) e o [build da imagem integrada](https://github.com/VitorFawkes/assistente-pessoal/actions/runs/35653060736) passaram. Source persistente do Easypanel e imagem efetiva coincidem; rollout concluído, réplica `1/1`.

Escopo publicado: conhecer objetivos e dificuldades declarados, ajudar a priorizar, orientar um próximo passo e acompanhar acordos concretos aceitos, inclusive sem tarefa ou reunião. O acompanhamento registra conclusão, avanço parcial, obstáculo e renegociação; não presume descumprimento pela ausência de registro. Uma proposta do coach ainda depende do aceite do usuário. Quando uma renegociação não informa data estruturada, o prazo anterior é removido e o relato permanece disponível para a retomada diária.

Treinamento de reuniões/1:1, avaliação da percepção do time, monitoramento de agentes e criação de eventos não fazem parte da rotina. A agenda principal Microsoft e os relatórios existentes acrescentam contexto; não comprovam execução ou comportamento. O referencial público Stanford de 2026 está separado dos eixos e das funções próprias do Ações.

- Migrations `0032`–`0034` aplicadas após backup privado validado e testes em Postgres isolado. Colunas, constraints, grants e RLS forçada foram conferidos em produção com `app_tenant`.
- Ponte TTARS integrada pelo [PR #1612](https://github.com/WelcomeTrips/ttars/pull/1612): sincronizador v4 e leitor v3 ativos. Vínculo dedicado configurado somente para a conta autorizada; demais variáveis do serviço preservadas. Sincronização e leitura reais retornaram `200`, com a mesma geração; bearer indevido retornou `401`. A CI do TTARS não iniciou por billing da organização; os comandos equivalentes passaram localmente.
- Modelo efetivo `openai/gpt-5.6-sol`, verificação semântica e objetivos/contexto existentes preservados. A delimitação pessoal mais recente foi salva no perfil autorizado.
- Validação: 396 testes unitários, 48 integrações Postgres, 10 testes dos runners, TypeScript, lint e build; 24 verificações de navegador com dados fictícios; Sol real em 17 cenários pessoais, quatro cenários de agenda mais um caso adversarial, dois casos de ações e dois ciclos com Postgres. Fixtures removidas após os testes.
- Produção: atualização autenticada da agenda conectada; conversa real concluída na primeira tentativa, resposta persistida após recarga; 22 verificações no navegador, com inspeção visual desktop/mobile. Origem indevida `403`, API sem sessão redirecionada a `/sem-acesso` sem dados privados e runner sem token `401`.
- Rodada autenticada do runner concluída em `2026-09-21T20:52:11Z`: HTTP `200`, `processed=1`, `failed=0`, `remaining=0`; revisão semanal persistida com o perfil atual e `last_error` vazio. A cobertura refere-se aos relatórios/resumos disponíveis, não a análise comportamental integral de todas as transcrições.
- Cron exclusivo restaurado após essa prova, a cada 15 minutos; daemon ativo, configuração privada e `--check` válido. Manhã às 8h, fechamento às 18h, retomadas pontuais e revisão semanal sexta às 17h, em São Paulo. Os acompanhamentos aparecem no próprio Ações; o horário configurado inicia a janela de preparação e não garante entrega instantânea.

A pendência de inferência real e cron pausado registrada abaixo pertence à versão anterior e foi encerrada nesta publicação. Conteúdo pessoal, capturas, sessão, token e snapshots de configuração permanecem em arquivos privados fora do repositório público. A validação comprova os fluxos exercitados, não eficácia longitudinal do coaching.

## Histórico: Coach v2 publicado — 20/09/2026

Imagem atual:`1346cb838f3c6f79b990691b2a1428165c4351be`, integrada pelo [PR#5](https://github.com/VitorFawkes/assistente-pessoal/pull/5). [CI final](https://github.com/VitorFawkes/assistente-pessoal/actions/runs/35549544911) e [build/publicação da imagem](https://github.com/VitorFawkes/assistente-pessoal/actions/runs/35549694573) concluídos. Source persistente do Easypanel e imagem efetiva alinhadas; rollout convergiu em1/1 réplica.

Configuração efetiva:`openai/gpt-5.6-sol`, Responses, busca semântica habilitada e telemetria sem prompts. Astra/Fable bloqueados. Objetivos e mensagens existentes preservados. Migrations0029–0031 aplicadas após backup privado validado; RLS forçada e isolamento com app_tenant conferidos.

Validação desta versão:330 testes unitários,31 integrações Postgres,10 testes dos runners,TypeScript,lint e build. Sol real com fixtures locais cobriu priorização, troca de meta, tarefa, correção, orientação junto da alteração, análise e revisão semanal. O replay semanal passou12/12 verificações. Navegador em produção passou16/16 verificações somente de leitura:desktop/mobile,reload,fontes,referências,modelo e respostas privadas sem cache. Origem indevida403 e cron semtoken401. Artefatos pessoais ficam em arquivos temporários privados.

**Pendente:inferência com contexto real nesta versão e retomada das rotinas.** O controle automático de permissões rejeitou esse envio à OpenAI, inclusive após a localização da autorização anterior explícita no histórico. Uma nova confirmação foi apresentada ao usuário. O cron exclusivo do coach foi preservado e está temporariamente pausado; seu arquivo está em `/root/acoes-coach-backups/cron-before-quality-v2`. O runner atualizado passou em `--check`, mas nenhuma rodada com dados reais desta versão foi iniciada.

As preferências solicitadas foram configuradas na conta autorizada:manhã8h,fechamento18h,alertas pontuais e semanal sexta17h(São Paulo). Elas só voltarão a executar quando o cron for restaurado após a confirmação pendente. Demais contas mantêm os padrões existentes. O novo hash das fontes exige reprocessar o histórico; não apresentar a cobertura completa da versão anterior como cobertura da versão atual. Ver [operação v2](coach-quality-v2-operations.md).

Versão anterior publicada em 2026-09-20: `37c00ef61b6d2997e22d07339ac2e511de955b0c`, integrada pelo PR #4, após as entregas dos PRs #2 e #3. [Build da imagem atual](https://github.com/VitorFawkes/assistente-pessoal/actions/runs/35532785508) concluído com sucesso. Imagem persistente do Easypanel e serviço efetivo conferidos; rollout concluído com réplica `1/1`. A cobertura do material elegível estava completa na verificação final; novas reuniões e correções continuam sendo processadas pela rotina existente.

## Verificação em produção

- Build da imagem: [GitHub Actions](https://github.com/VitorFawkes/assistente-pessoal/actions/runs/35524229530), concluído com sucesso.
- [Coach publicado](https://acoes.vitorgambetti.com.br/coach): leitura autenticada `200`; sem sessão, redirecionamento `307` para acesso; origem indevida `403`; memória inexistente `404`; rotina sem token `401`.
- Cinco tabelas com RLS forçada. 41 verificações passaram com o papel real `app_tenant`, incluindo SELECT/UPDATE cruzado, contexto vazio e FK de reunião/usuário. Transação de teste revertida e ausência das fixtures confirmada.
- Navegador de produção: memória criada, corrigida e preservada após recarga; histórico da edição visível. Layout de 390px sem rolagem horizontal.
- Configuração persistente do Easypanel e imagem efetiva alinhadas. Token dedicado configurado, sem modificar variáveis não relacionadas. Runner instalado e `--check` passou; configuração e logs têm permissão `0600`.
- Após confirmação explícita do envio à API da OpenAI, conversa real e primeira rodada do runner retornaram `200` e persistiram os resultados. Citações conferidas contra transcrição, chunk, hash e autoria confirmada; memórias automáticas permaneceram como hipóteses.
- Cron instalado a cada 15 minutos, daemon ativo, log e configuração privados. Um disparo real encontrou o backfill em andamento e respeitou o lock compartilhado. Backfill sequencial limitado a quatro horas e 250 rodadas; progresso salvo permite retomada.
- O ciclo semanal fecha na sexta-feira às 17h de São Paulo; a revisão depende da análise completa daquele período. Horário de fechamento não promete entrega instantânea: o runner e o provedor acrescentam latência.
- A primeira revisão automática foi persistida somente após completar seu período. Evidências e versão do perfil conferidas; uma rodada posterior preservou a identidade e a data da revisão, comprovando idempotência.

A validação da conversa real motivou uma correção: o servidor agora preserva na mensagem os campos de observação, hipótese e outra explicação já fundamentados pelo modelo, em vez de exibir somente sua prosa livre. O contexto consultado e a data da contagem de cobertura também ficam explícitos. A correção passou em 215 testes unitários, build e um ciclo real com o provedor usando somente dados fictícios (28 verificações). A revisão semanal deixa de gravar contagens globais transitórias do acervo, limita as observações ao foco escolhido e preserva um único experimento principal. O título propõe um foco sem inferir ausência de hábito a partir da falta de evidência.

Conferência da imagem final em produção: nova conversa com evidência e caminho sem evidência testados; distinções e limites preservados após recarga. Revisão regenerada com a mesma identidade semanal, um experimento principal e fontes atuais. Navegação de ida e volta para fontes, desktop e celular passaram, sem erros no console ou rolagem horizontal. As chamadas anteriores foram concluídas antes do rollout; cron e backfill retomados, com progresso preservado e uma nova rodada concluída na imagem atual.

Resultados e capturas que contêm contexto pessoal ficam somente em arquivos temporários privados, fora deste repositório público. Identificação de participantes e consistência entre segmentos/transcrição limitam as observações pessoais; o coach não deve inventar autoria para completar cobertura.

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

## Conversa como entrada principal — 2026-09-20

A melhoria mantém o coach dentro do Ações e a revisão semanal existente. A tela abre em Conversa, com o campo de mensagem antes do histórico e atalhos que apenas preenchem um rascunho. Orientação aparece primeiro; leituras, alternativas, fontes e limites continuam acessíveis por expansão.

O comportamento conversacional pede uma direção útil por vez, cobrança respeitosa sustentada pelos registros e reconhecimento específico. Consequências não observadas são riscos, não fatos. Declarações explícitas do usuário podem virar memórias identificadas como autorrelato: quotes são limitadas pelo schema às frases declarativas da mensagem atual e novamente conferidas no servidor. Reafirmar uma nota confirmada atualiza sua recência e histórico; rejeições anteriores não são sobrescritas. Essa memória complementa o perfil, sem modificar silenciosamente as configurações.

A recuperação considera o panorama agregado de todas as tarefas/frentes e uma seleção limitada de prioridades, prazos, relevância e atividade. A carga de execução usa `acao`, preservando a distinção entre executar, cobrar e aguardar. Perguntas sobre hoje, ontem ou esta semana usam o fuso do perfil; reuniões anteriores ficam separadas. Data de cadastro/importação não comprova quando uma reunião aconteceu. Continua sem integração com agenda externa ou atividade dos agentes fora do Ações.

Nenhuma migration nova ou novo agendamento foi criado. A conferência do schema real detectou que a migration existente `0015_tarefa_frentes.sql`, necessária à seleção de frentes, ainda estava pendente. Ela foi aplicada antes do rollout, após backup privado validado pelo `pg_restore` da mesma versão do servidor. Backfill, constraints, grants, ausência de referências cruzadas e isolamento com o papel real `app_tenant` passaram; a conferência foi somente leitura. A referência técnica de personalidade, concisão e avaliação é o [GPT-5.1 Prompting Guide da OpenAI](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-1_prompting_guide); o método de liderança e as distinções entre fontes Stanford e adaptações do Ações permanecem documentados em `docs/research/2026-09-20-leadership-coach-sources.md`.

Validações locais: 230 testes unitários, 20 testes de persistência/isolamento e seleção em Postgres (147 verificações), seis cenários fictícios com o provedor real mais uma regressão de linguagem (123 verificações), TypeScript, lint e build. A prova com o provedor cobre sobrecarga, cobrança fundamentada, avanço específico, correção/meta, ausência de dados do dia e próximo passo curto. Relatórios ficam em arquivos temporários privados; nenhum dado de produção faz parte das fixtures. Esses casos não garantem resposta perfeita em todas as conversas.

Dois testes adicionais com provedor real e banco local passaram (33 verificações): ciclo análise/revisão/conversa, objetivo declarado persistido como autorrelato e orientação curta na pergunta seguinte. A CI do commit final passou em testes unitários, Postgres, runner, TypeScript, lint e build. No navegador local, 22 verificações desktop e 10 mobile passaram; respostas ao próprio envio entram na área visível sem deslocar quem subiu para ler mensagens anteriores.

Após publicar, duas conversas reais autorizadas responderam `200`, com evidências verificadas contra a transcrição atual e persistência após recarga. A pergunta de acompanhamento recebeu uma orientação de 52 palavras, com fundamentos recolhidos em detalhes. Entrada em Conversa, atalhos sem envio automático, preservação de rascunhos entre abas, fontes, revisão, memória, referenciais e ausência de overflow passaram em desktop e celular. Cobertura preservada, revisão semanal mantida e `last_error` vazio. Conteúdo e capturas pessoais permanecem fora do repositório público.

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

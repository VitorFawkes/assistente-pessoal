# Coach: qualidade da orientação e continuidade

## Problema e comportamento esperado

Uma resposta podia citar a agenda e ainda devolver ao usuário a dificuldade que ele pediu ajuda para resolver: “escolha uma prioridade”. O critério de publicação agora examina também a contribuição para a decisão. Havendo alternativas conhecidas, o coach deve comparar consequências ou dependências, recomendar um começo com fundamento ou esclarecer a informação que realmente pode mudar a escolha.

Quando o usuário explicou a finalidade de um bloco da sua rotina, o coach usa essa finalidade para propor uma questão concreta e explicar como a conversa pode ajudar. O encerramento de um combinado tem confirmação explícita de conclusão, enviada somente após persistência. O título de um evento, sozinho, não revela seu propósito pessoal. O pedido atual prevalece: escuta, reconhecimento, mera alteração e execução de uma escolha já feita não precisam virar exercícios de priorização.

Recomendação não é aceite. Prazo não comprova pessoa aguardando. Acompanhamento posterior ao prazo não equivale a sugerir execução atrasada. Orientações em `actions[].guidance` passam pelo mesmo critério que respostas sem ações; o recibo de persistência continua sendo responsabilidade do servidor.

## Implementação

- Instruções de conversa, revisão semanal e acompanhamentos pedem contribuição concreta e progressão em relação ao histórico. Perguntas sobre rotina, planejamento e escolha usam raciocínio aprofundado.
- Verificação e uma tentativa limitada de reparo tratam utilidade, evidências, continuidade e escopo. O limite existente de uma pergunta, incluindo citações, é conferido antes da análise semântica no texto que será efetivamente publicado; uma lista de perguntas aciona esse mesmo reparo antes de qualquer ação ser salva. Uma paráfrase da mesma orientação rejeitada não resolve uma falha de utilidade.
- As leituras adicionais de tarefas e memória ficam disponíveis à verificação, ao reparo e à ressíntese semanal após correções. Datas, limitações e vetos permanecem associados aos resultados.
- Não há migration, mudança de modelo, novo agendamento nem alteração de permissões. Agenda continua somente leitura.

## Avaliação reproduzível

`frontend/lib/coach/guided-coaching.provider.test.ts` contém casos sintéticos pagos, desativados por padrão. Para executá-los com a chave já configurada no ambiente:

```sh
cd frontend
COACH_PROVIDER=openai COACH_MODEL=gpt-5.6-sol COACH_GUIDED_TEST=1 \
  bun --no-env-file test lib/coach/guided-coaching.provider.test.ts
```

O arquivo cobre respostas inadequadas conhecidas, controles positivos e geração com os prompts efetivamente usados na conversa e no acompanhamento da manhã. A sequência de cinco turnos usa as respostas anteriores realmente geradas: indecisão, aceite, bloqueio, renegociação e conclusão. A simulação reproduz estado e recibos para avaliar continuidade; não substitui os testes de persistência e isolamento com Postgres.

Uma rubrica separada examina contribuição, propósito, participação e continuidade, referenciando trechos reais por IDs. Também é feita leitura das respostas publicáveis e do guidance. O avaliador usa o mesmo modelo e pode errar: seu resultado sozinho não comprova qualidade.

A orientação genérica aceita pelo verificador anterior foi reproduzida antes da mudança. Rodadas intermediárias expuseram uma rotina sem participação concreta, um falso bloqueio de fechamento após o prazo e uma dependência externa inventada. Os casos foram preservados como controles. A sequência completa também revelou uma confirmação genérica demais para uma conclusão sem orientação adicional; o recibo do servidor foi corrigido e compartilhado com a avaliação para evitar divergência de textos. Ajustes do harness corrigiram citações inexatas do juiz, reconhecimento de conselho condicional útil e avaliação de conclusão com o recibo que o usuário realmente recebe; não converteram falhas de produto em sucesso.

Os testes de serviço exercitam chamadas de ferramentas, duas verificações e reparo no chat, além da ressíntese semanal. Uma mutação temporária removendo os encaminhamentos de contexto faz as duas regressões falharem. Nenhum dado pessoal integra as fixtures públicas; logs e capturas de produção permanecem privados.

A abordagem segue a recomendação de [avaliações específicas à tarefa e calibração humana da OpenAI](https://developers.openai.com/api/docs/guides/evaluation-best-practices). Os resultados comprovam os casos exercitados e a publicação da versão testada, não resposta perfeita em toda conversa nem eficácia longitudinal do coaching.

## Conferência da conversa real

A primeira publicação foi validada tecnicamente, mas a repetição da pergunta original ainda produziu uma rotina que prometia comparar frentes depois. A leitura das fontes confirmou o problema de atualidade: tarefas antigas coexistem com relatos recentes, sem que isso confirme uma prioridade vigente. A revisão independente considerou insuficiente a contribuição entregue naquele turno.

O refinamento passa a rejeitar critérios abstratos ou promessa futura como substitutos de ajuda atual. A resposta deve aplicar um critério a uma alternativa ou dúvida concreta, ou conduzir o esclarecimento da lacuna decisiva. Registros antigos podem sustentar uma hipótese de foco com checagem de vigência; não viram urgência ou dívida confirmada.

Dois novos casos inteiramente fictícios reproduzem essa combinação. O candidato genérico foi rejeitado na avaliação do refinamento. Em 22/09, com a cota do provedor restabelecida, os dois testes do bloco passaram: o verificador reprovou um primeiro rascunho com mais de uma pergunta, e o reparo foi aprovado pelo juiz nos três critérios (contribuição atual, atualidade e dificuldade conhecida). A primeira tentativa, de 21/09, foi interrompida antes da análise semântica e não é contada como reprodução RED.

Antes da publicação, a versão também foi exercitada contra uma cópia local do banco de produção (papel `app_tenant`, RLS ativa) e a agenda real, sem escrita em produção: seis conversas (rotina em duas amostras, aceite, acompanhamento da manhã, fechamento e relato de desvio). Todas passaram na primeira verificação, com recomendação concreta e justificada a partir do contexto, retomada do combinado pelo nome e confronto respeitoso do desvio. Na mesma cópia, a versão anterior também indicou uma frente concreta, mas deixou a confirmação para depois; a diferença observada é incremental. O conteúdo pessoal dessas conversas fica fora do repositório.

A conferência visual também identificou listas numeradas reiniciando em 1 a cada linha vazia. O renderer agora mantém os itens consecutivos no mesmo bloco, preservando separações por parágrafo e o escape de HTML.

## Evidências desta entrega

Resultados finais de testes, CI e produção são registrados em `docs/coach-deployment.md` após cada etapa ser verificada.

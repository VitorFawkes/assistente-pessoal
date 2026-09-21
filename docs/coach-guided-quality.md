# Coach: qualidade da orientação e continuidade

## Problema e comportamento esperado

Uma resposta podia citar a agenda e ainda devolver ao usuário a dificuldade que ele pediu ajuda para resolver: “escolha uma prioridade”. O critério de publicação agora examina também a contribuição para a decisão. Havendo alternativas conhecidas, o coach deve comparar consequências ou dependências, recomendar um começo com fundamento ou esclarecer a informação que realmente pode mudar a escolha.

Quando o usuário explicou a finalidade de um bloco da sua rotina, o coach usa essa finalidade para propor uma questão concreta e explicar como a conversa pode ajudar. O encerramento de um combinado tem confirmação explícita de conclusão, enviada somente após persistência. O título de um evento, sozinho, não revela seu propósito pessoal. O pedido atual prevalece: escuta, reconhecimento, mera alteração e execução de uma escolha já feita não precisam virar exercícios de priorização.

Recomendação não é aceite. Prazo não comprova pessoa aguardando. Acompanhamento posterior ao prazo não equivale a sugerir execução atrasada. Orientações em `actions[].guidance` passam pelo mesmo critério que respostas sem ações; o recibo de persistência continua sendo responsabilidade do servidor.

## Implementação

- Instruções de conversa, revisão semanal e acompanhamentos pedem contribuição concreta e progressão em relação ao histórico. Perguntas sobre rotina, planejamento e escolha usam raciocínio aprofundado.
- Verificação e uma tentativa limitada de reparo tratam utilidade, evidências, continuidade e escopo. Uma paráfrase da mesma orientação rejeitada não resolve uma falha de utilidade.
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

## Evidências desta entrega

Resultados finais de testes, CI e produção são registrados em `docs/coach-deployment.md` após cada etapa ser verificada.

# Avaliação sintética real do coach — 20/09/2026

Estado: **rodada limitada concluída, com falhas originais preservadas e dois casos reavaliados após correções**. Nenhum resultado aqui estabelece um campeão universal nem substitui revisão humana ou teste do aplicativo completo.

## Escopo e método

Comparação autorizada de `gpt-5.6-sol` e `gpt-5.1`, esforço `high`, em `priority-01`, `attribution-01` e quatro etapas de `interpretation-corrected`. Teto agregado: 36 requisições e US$ 8 de reserva conservadora. Astra e Fable não foram usados. Somente cenários fictícios; nenhuma consulta a reuniões, banco de produção ou conteúdo pessoal.

O mesmo dataset, prompt e código produziram a primeira rodada: dataset SHA-256 `ea3906ac7024c10aae5535b5ba76a85dd5ac8f82abee69b793a04ded683f5ee9`, prompt `fe84f651818abe8e127439e6b17e37dfaf28796ac89720977d11a34e77b8002a`, código `db37792dfd3bb52f17acfdf99b0439e99cf4d37cbee593ce16bf7abe2961e5a9`. Os artefatos privados contêm versões e contagens por chamada. A leitura qualitativa foi feita por Codex, com rótulos A/B sorteados e decisões registradas antes de abrir a chave. **Isso não é um experimento científico nem avaliação humana independente.**

O runner verifica contratos objetivos; não mede automaticamente a qualidade semântica. Nas sequências, respostas reais anteriores são preservadas, mas memórias/correções são snapshots controlados. Não é prova de persistência, busca Postgres ou rotina proativa em produção.

## Incidente de contrato da API, corrigido

Três tentativas com Sol no Chat Completions retornaram HTTP 400 (`invalid_request_error`, parâmetro `reasoning_effort`), sem uso reportado e sem executar ferramentas. A consulta de disponibilidade reconhecia o modelo. A correção foi selecionar Responses explicitamente para Sol/GPT-5.5, com `reasoning.effort`, `text.format`, `store:false` e preservação integral dos itens de raciocínio criptografado e ferramentas. Não houve downgrade de esforço nem fallback. GPT-5.1 permanece no contrato Chat Completions.

Contrato documentado: [migração para Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses), [raciocínio](https://developers.openai.com/api/docs/guides/reasoning) e [ferramentas](https://developers.openai.com/api/docs/guides/function-calling). Depois da correção, Sol concluiu seis casos, inclusive dois com round trips reais de ferramentas.

A reserva das três chamadas recusadas foi US$ 0,699192. Seu custo faturado é desconhecido; não o tratamos como zero. A telemetria passou a informar status e categorias técnicas permitidas, sem corpo remoto, prompt ou credencial, e marca `usageComplete=false` quando não recebe tokens.

## Primeira rodada: achados que os contratos não bastam para detectar

- **Prioridade:** os dois escolheram a proposta com prazo. GPT-5.1 apresentou próximos passos executáveis e foi preferido na leitura A/B. Sol afirmou que eram 18h e implicou atraso; o contexto era 18:00 UTC, equivalente a 15h em São Paulo, antes do prazo das 16h. Isso é erro factual de tempo. Nenhum candidato abriu a segunda fonte, que esclarecia que a melhoria visual era da plataforma, sem usuário ou prazo; ambos consideraram que pudesse ser da proposta.
- **Atribuição:** Sol recusou usar uma fala de Bia como prova sobre o usuário e deixou `observations` vazio, mas continuou com uma pergunta excessivamente longa e repetitiva. GPT-5.1 foi mais legível e também reconheceu verbalmente a falta de evidência própria, porém emitiu uma observação de delegação sustentada somente na fala de Bia. O checker registrou `observation_without_self_evidence`, interrompendo a rodada até autorização para concluir a sequência separadamente. Nenhuma das duas respostas atende integralmente à experiência desejada.
- **Hipótese de implementação:** a regex que limitava o campo `answer` a uma interrogação pode ter contribuído para a repetição na geração estruturada. Ainda não há experimento isolado que estabeleça causalidade. A correção mantém a orientação de uma pergunta no prompt e retira a regex, reduzindo também o tamanho normal da resposta. O fuso passa a ser formatado deterministicamente antes de enviar o contexto. Novas respostas devem ser registradas com outra versão do harness, sem substituir as falhas originais.

## Correções ao longo do tempo

Ambos respeitaram a correção explícita de que Alex revisa riscos e Bia executa/decide detalhes; nenhum voltou a afirmar como fato a hipótese rejeitada de que Alex fazia tudo. Na leitura A/B registrada antes do mapping, a primeira etapa empatou; Sol foi preferido nas três seguintes por reconhecer a correção diretamente, distinguir fala registrada de execução observada e usar a evidência mais recente.

Na última etapa, Sol buscou a fonte nova “Bia decidiu os detalhes e eu aceitei sem refazer”, ligou-a às falas anteriores e limitou a conclusão a autorrelatos, sem generalizar um padrão. GPT-5.1 manteve a correção, mas não usou essa fonte nova e apresentou uma conclusão mais forte apoiada nos registros anteriores. Isso sugere uma vantagem de Sol nessa sequência específica; não comprova melhor coaching em todos os contextos.

## Reavaliação após as mudanças

O dataset permaneceu intacto. A nova rodada usa harness `synthetic-context-adapter-v2-local-time`, prompt `09d3531d3892229b94870c9de7bc5244449b61e1d7b74a0d0166508d456be88b` e código `15f290b9584a257bdd1354de9bacf9a426649986fef804d27941c9e1a2659688`. O helper de datas entra no fingerprint. A resposta normal passou a no máximo 1.000 caracteres e saiu a regex de interrogações; a orientação de no máximo uma pergunta continua no prompt. Por terem mudado várias coisas juntas, não atribuímos causalidade à remoção da regex isoladamente.

Os dois casos Sol foram novamente lidos qualitativamente, desta vez com identidade conhecida:

- **Prioridade:** escolheu proposta, explicou o prazo e propôs 30 minutos para decidir/conteúdo e 10 para revisão/preparação. Não afirmou horário errado ou atraso inexistente. Continuou sem abrir a segunda fonte; tratou eventual dependência visual apenas como possibilidade, não como fato.
- **Atribuição:** reconheceu que a fala era da colega e insuficiente para avaliar a conduta do usuário, sem gerar observação/memória dessa fala. Resposta curta, sem repetição patológica.

Não detectamos falha crítica nessas duas novas respostas. Isso é evidência de regressão localizada corrigida nos exemplos observados, não prova de perfeição ou estabilidade estatística. A sequência completa não foi repetida com o novo harness nesta rodada.

## Uso e custo observado

| Rodada | Casos concluídos | Requisições | Tokens entrada / saída | Mediana / máxima por caso | Estimativa sem desconto de cache |
|---|---:|---:|---:|---:|---:|
| Sol original | 6 | 9 | 34.544 / 4.184 | 11,84 s / 17,92 s | US$ 0,221856 |
| GPT-5.1 original | 6 | 10 | 37.697 / 8.865 | 16,69 s / 30,38 s | US$ 0,135771 |
| Sol após correções | 2 | 2 | 6.517 / 886 | 9,69 s / 10,23 s | US$ 0,043788 |

As 14 saídas concluídas custam **US$ 0,401415 estimados**, pelas contagens reportadas e preços de referência sem desconto de cache; não é uma fatura. Soma-se o custo desconhecido das três HTTP400. Houve **24 requisições** no total, dentro do limite de 36, e **US$ 4,425188 de reserva conservadora**, dentro do teto de US$ 8. Nenhuma chamada Astra/Fable. Foram reportados 10.031 tokens de entrada em cache para Sol original e 22.528 para GPT-5.1; não descontamos isso na estimativa.

O caso de atribuição GPT-5.1 teve saída JSON concluída mas falha de contrato de evidência: ele consta na tabela e no relatório; não desaparece dos resultados. Uma CLI recusada por destino temporário e consultas GET de disponibilidade não foram contadas como inferência. A reserva não foi reutilizada para rodadas ilimitadas.

## Limites e uso na decisão

Recomendação provisória para este projeto: manter Sol com esforço adaptativo, contrato Responses e verificações de evidência/qualidade, usando high para investigação e revisão difícil. A sequência mostrou um motivo concreto para escolhê-lo apesar do custo maior que GPT-5.1, e as falhas de tempo/estilo encontradas foram tratadas. GPT-5.1 é candidato de contingência explícita, mas não deve ser acionado silenciosamente nem promovido sem tratar sua falha de atribuição. Não promover um modelo por preço, por passagem de schema ou pela eloquência de um exemplo. Esta bateria curta já mostra motivos para manter validação de evidências, dados de tempo explícitos, correções auditáveis e revisão qualitativa. Opus e Kimi têm contratos implementados/mocados, mas não foram avaliados por API nesta rodada porque não havia credenciais. Não há comparação empírica com eles.

Relatórios, respostas e chave A/B permanecem em diretório temporário privado. Este documento contém somente resultados sintéticos agregados. Os 20 casos holdout não foram executados, e as correções foram avaliadas nos mesmos dois casos de desenvolvimento: existe risco de adaptação aos exemplos. Próximas avaliações devem incluir casos novos, repetição e revisão humana, além dos testes de integração do produto.

# Avaliação sintética real do coach — 20/09/2026

Estado: **avaliação em andamento; falhas detectadas e preservadas**. Nenhum resultado aqui estabelece um campeão universal nem substitui revisão humana ou teste do aplicativo completo.

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

## Limites e uso na decisão

Não promover um modelo por preço, por passagem de schema ou pela eloquência de um exemplo. Esta bateria curta já mostra motivos para manter validação de evidências, dados de tempo explícitos, correções auditáveis e revisão qualitativa. Opus e Kimi têm contratos implementados/mocados, mas não foram avaliados por API nesta rodada porque não havia credenciais. Não há comparação empírica com eles.

Relatórios, respostas e chave A/B permanecem em diretório temporário privado. Este documento contém somente resultados sintéticos agregados. A atualização final acrescentará contagens, custos estimados, sequência de correção e rerun após as mudanças.

# Coach Ações: proposta de evolução orientada à qualidade

Data: 20/09/2026. Estado: **proposta arquitetural; não implementada nem validada em produção**. Nenhuma comparação entre modelos com reuniões pessoais foi executada nesta avaliação.

## Decisão recomendada

Reconstruir o motor de investigação, memória e acompanhamento. Preservar autenticação, isolamento por usuário, Postgres, registros de reuniões/tarefas e uma interface centrada na conversa. A continuidade do coach pertence ao Ações, não à memória de um provedor.

Manter o Next.js como interface e API autenticada. Isolar o motor em um módulo de servidor testável, com ferramentas e adapters de modelos. Análises longas e revisões usam um worker com fila persistente, tentativas controladas, cancelamento e progresso; não dependem de manter uma requisição HTTP aberta. O chat pode transmitir progresso e resposta sem expor raciocínio interno. Reaproveitar Postgres e os contratos de leases/idempotência existentes antes de acrescentar serviços de infraestrutura.

O resultado esperado é ajudar Vitor a identificar o problema mais importante, escolher o que fazer e deixar de fazer, desenvolver sua atuação como líder e acompanhar as consequências dessas escolhas. Quantidade de mensagens, tarefas fechadas e elogios não são medidas suficientes desse resultado.

| Alternativa | Benefício | Limite | Decisão |
|---|---|---|---|
| Trocar somente o modelo | Mudança pequena e comparação simples | Mantém lacunas de recuperação, memória temporal e acompanhamento | Usar apenas como controle experimental |
| Um coach com ferramentas e etapas de revisão | Permite investigar e acompanhar com experiência simples | Exige memória, ferramentas e avaliações bem construídas | Arquitetura recomendada |
| Vários agentes permanentes debatendo cada resposta | Pode ampliar exploração em alguns problemas | Multiplica latência, custo e possibilidades de erro; consenso não prova verdade | Adicionar apenas onde houver ganho medido |

## Experiência para o usuário

Uma conversa principal, um foco atual e uma revisão semanal. Objetivos e correções podem ser comunicados em linguagem natural. Fontes, histórico e controles ficam acessíveis sem obrigar a preencher painéis.

A resposta normalmente traz a decisão principal, sua justificativa e um próximo passo. Quando houver priorização, também explicita o que adiar, delegar ou abandonar. O usuário pode pedir aprofundamento; o formato curto não deve impedir uma análise solicitada.

Exemplo fictício de comportamento desejado: “Você combinou entregar a proposta do cliente amanhã e abriu outra melhoria de plataforma. Minha recomendação é terminar a proposta antes de iniciar essa melhoria. Se existe um bloqueio técnico que altera essa escolha, precisamos considerá-lo.” A resposta real deve apontar os registros que sustentam cada afirmação e não presumir o trabalho feito fora do Ações.

Franqueza significa contestar uma decisão com fundamento, reconhecer avanços documentados e aceitar correção. Não significa produzir uma bronca em toda conversa.

## Fontes e recuperação

1. Corrigir a perda de elegibilidade de falas que atravessam fronteiras de trechos, identificada na auditoria. Preservar texto original, falante, posição, reunião e versão. Timestamps só quando disponíveis.
2. Criar uma representação por reunião com decisões, compromissos, questões em aberto e observações, sempre vinculados à origem. Resumos são índices de acesso, não substitutos definitivos da transcrição.
3. Combinar busca lexical e semântica com filtros por período, pessoa e projeto. Reformular buscas com o assunto da conversa; diversificar reuniões e recuperar evidências contrárias.
4. Dar ferramentas ao coach para buscar, abrir trecho e vizinhança, consultar metas/correções e ler tarefas/resultados. Uma primeira busca insuficiente deve permitir investigação adicional.
5. Versionar extrações e análises por fonte, método, prompt e modelo. Mudanças de objetivos podem provocar releitura seletiva do material relevante; correções da fonte invalidam conclusões dependentes.

Não escolher agora uma nova infraestrutura vetorial como requisito do produto. Definir o contrato de busca, testar qualidade e carga, e só então decidir sua implementação no ambiente Postgres existente. Não confundir cobertura de processamento com cobertura efetiva das fontes usadas na resposta.

## Memória persistente e temporal

Manter separadamente:

- Contexto e preferências declarados pelo usuário.
- Objetivos vigentes, substituídos e encerrados; projetos ativos, pausados e abandonados.
- Decisões, compromissos aceitos, prazos, renegociações e resultados observados ou relatados.
- Observações e hipóteses sobre comportamentos, com fontes, contexto e contraexemplos.
- Correções ligadas à interpretação original, inclusive versões derivadas que precisam ser invalidadas.

Registrar data do acontecimento, data de conhecimento, origem, validade e relação de substituição. Uma nova meta não deve coexistir silenciosamente com uma meta contraditória antiga. Se a intenção de substituir for ambígua, fazer uma pergunta curta na conversa.

Avaliar decisões passadas à luz dos objetivos e informações disponíveis naquela época; usar os objetivos atuais para orientar os próximos passos. Uma mudança legítima de prioridade não constitui, sozinha, incoerência ou falha de compromisso.

Correções importantes não podem depender de estar entre as últimas notas recuperadas. Impedir que uma interpretação rejeitada volte como fato apenas porque recebeu outra redação. O autorrelato continua identificado como autorrelato; repetição da própria interpretação pelo sistema não vira confirmação independente.

Aprender aqui significa atualizar memória, hipóteses e estratégias a partir de resultados. Não exige treinar os pesos de um modelo com dados pessoais.

## Investigação e revisão proporcionais à tarefa

Fluxo: pergunta ou evento → objetivo vigente → evidências relevantes → alternativas e lacunas → verificação → orientação → acordo → acompanhamento.

Perguntas simples usam um caminho curto. Priorização entre frentes, conflitos, padrões comportamentais e revisão semanal justificam investigação maior e esforço de raciocínio superior. Limites de tempo e chamadas devem impedir ciclos sem progresso, sem transformar truncamento em uma resposta aparentemente completa.

Uma revisão adicional recebe conclusões, fontes originais e critérios explícitos. Verifica atribuição, suporte semântico, contraevidência, meta vigente e utilidade. Deve poder remover uma conclusão ou exigir mais contexto. Um segundo modelo só permanece nessa função se melhorar os resultados medidos; concordância entre modelos não é um mecanismo de certificação.

As seis competências e as referências de Stanford continuam descritas em [fontes e adaptação do Ações](../../research/2026-09-20-leadership-coach-sources.md). O método continua sendo adaptação própria, com comportamentos observáveis e experimentos, sem notas artificiais de personalidade ou alegação de avaliação oficial Stanford.

## Compromissos e proatividade

Uma decisão aceita na conversa pode criar ou atualizar tarefa por operação tipada, escopada ao usuário, idempotente e auditável. Reaproveitar o sistema de tarefas; a ponte atual do agente no Mac não deve ser tratada como integração já disponível ao coach.

O acompanhamento diferencia combinado, realizado segundo registro, relatado pelo usuário, renegociado e desconhecido. Atualização de uma tarefa não comprova execução. Ausência de gravação não comprova inatividade.

Cadência inicial proposta, ajustável na conversa:

- Início do dia: uma prioridade e principal compromisso, quando houver base suficiente.
- Durante o dia: intervenção excepcional diante de conflito relevante, prazo ameaçado ou novo compromisso incompatível; agrupar eventos e aplicar intervalo entre alertas.
- Final do dia: fechamento curto do que foi combinado, evidências disponíveis e pendências de contexto; evitar repetir o alerta anterior.
- Semanal: comparação entre intenção e atuação, avanços e dificuldades sustentados por exemplos, retorno sobre o experimento anterior e um novo experimento prioritário.

Usar o Ações como canal inicial; notificações externas são uma integração separada. O estado ativado/pausado e a preferência de cadência devem ser respeitados. Para enxergar as frentes dos nove agentes ou a agenda externa, são necessárias integrações reais ou um relato do usuário. Não presumir acesso a esses dados.

## Modelos: configuração inicial para avaliação

A configuração abaixo é uma hipótese de partida, não um ranking de coaching comprovado.

Restrição explícita do Vitor: **Astra e Fable estão excluídos pelo custo**, inclusive de testes pagos, revisão, escalonamento e fallback. Buscar a melhor qualidade entre os candidatos permitidos, com investigação e verificação adequadas à dificuldade.

| Papel | Candidato inicial | Motivo da escolha para teste | Preço de referência, USD por milhão de tokens de entrada/saída |
|---|---|---|---|
| Coach principal e análise semântica das reuniões | Claude Opus 5, começando em esforço high | Avaliar conversa, investigação e raciocínio com uma base forte; não depender de um extrator barato antes de medir perdas | 5 / 25 |
| Revisão crítica de avaliações importantes; candidato alternativo ao principal | GPT-5.6 Sol | Permite comparar outra família de modelos com ferramentas e raciocínio ajustável; diversidade é hipótese de benefício, não garantia | 4 / 20 |
| Concorrente para investigação e eventual papel principal | Kimi K3 | Incluir seriamente uma alternativa com raciocínio e ferramentas, avaliando qualidade e custo reais | 3 / 15 |

Preços padrão sem cache, consultados em 20/09/2026: [Opus 5](https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5), [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) e [anúncio oficial do Kimi K3](https://forum.moonshot.ai/t/kimi-k3-is-here-our-most-capable-model/480). Sol tem tarifa promocional vigente pelo menos até 21/11/2026 e sobretaxa em entradas acima de 272 mil tokens. Raciocínio, tamanho do contexto, cache e tokenização alteram o custo efetivo; estes valores não são uma estimativa da conta mensal do usuário.

Opus 4.6 deve entrar como comparação de qualidade conversacional. Os casos difíceis serão avaliados com os candidatos permitidos, variando esforço de raciocínio, investigação e revisão conforme o ganho observado. GLM 5.3 e DeepSeek V4.1 Flash são candidatos posteriores para etapas delimitadas de extração e organização. Nenhum desses papéis é atribuído com base apenas no preço ou na nacionalidade do fornecedor.

Kimi exige atenção específica ao estado da sessão: sua documentação alerta para preservar o histórico exigido pelo modelo e evitar troca para K3 no meio de uma sessão. O adapter precisa respeitar esse contrato. Memória de negócio é compartilhável; estado interno de execução e raciocínio de provedores diferentes não deve ser intercambiado. [Limitações oficiais do Kimi K3](https://www.kimi.com/en/blog/kimi-k3).

Construir adapters por provedor para ferramentas, saída estruturada, estado, erros, uso e limites. Fixar versões quando disponíveis, registrar alterações e testar novamente. Um papel pode continuar no modelo principal se a especialização não trouxer benefício.

Economizar primeiro por análise incremental, cache, recuperação relevante e reaproveitamento de resultados válidos. Um modelo barato só assume uma etapa se preservar seu padrão de qualidade. Indisponibilidade não autoriza uma troca silenciosa para um modelo inferior; usar alternativa já validada ou informar a indisponibilidade.

## Como decidir qualidade e efetividade

Começar com aproximadamente 60 casos e seis sequências de várias semanas: priorização, delegação, comunicação, compromissos, objetivos alterados, interpretações corrigidas, evidência contraditória e dados insuficientes. Separar desenvolvimento e avaliação reservada, sem informações do futuro nos testes históricos.

Comparações necessárias:

1. Coach atual, como referência.
2. Novo motor com o mesmo modelo, para medir ganho de arquitetura.
3. Diferentes modelos no novo motor, com ferramentas equivalentes e configurações compatíveis.
4. Com e sem revisão adicional, para medir seu ganho líquido.

Avaliar fidelidade às fontes, recuperação de evidência decisiva e contrária, qualidade da prioridade, respeito à memória corrigida, franqueza apropriada, clareza e viabilidade do próximo passo. Decisões ambíguas admitem alternativas justificadas; não usar gabarito artificialmente único.

Comparações cegas e avaliação humana calibram os avaliadores automáticos. Repetir casos difíceis; uma nota média não pode esconder regressão em memória ou evidência. Amostras pequenas sem diferença detectada não provam equivalência: ampliar a avaliação antes de promover uma alternativa quando o resultado for inconclusivo. O usuário participa por amostras curtas de utilidade e correções naturais, sem assumir o trabalho de testar todo o sistema.

Revisores externos usam casos sintéticos ou adequadamente desidentificados. Conteúdo pessoal identificável permanece restrito ao usuário e a revisores especificamente autorizados; a etapa de avaliação não amplia implicitamente o acesso ao acervo.

Bloquear uma versão ao encontrar vazamento entre usuários, citação inventada, atribuição incorreta, ação sem autorização, objetivo substituído tratado como atual, interpretação rejeitada reapresentada como fato ou alegação falsa de observação/execução. Também testar instruções maliciosas dentro das transcrições. Nenhuma ocorrência na bateria é critério de lançamento, não garantia de ausência futura de erro.

Medir custo por conversa útil e revisão concluída, latência, necessidade de correções e acompanhamento de compromissos. No uso longitudinal, observar clareza de prioridades e evolução dos experimentos, sem atribuir automaticamente todo resultado profissional ao coach.

Essa política aplica a ordem recomendada de [qualidade antes de custo](https://developers.openai.com/api/docs/guides/model-selection) e avaliações específicas com [calibração humana](https://developers.openai.com/api/docs/guides/evaluation-best-practices). Esses guias não comprovam a eficácia deste produto.

## Privacidade e operação

Cada busca, memória, ferramenta e tarefa continua escopada ao usuário. Dados pessoais permanecem no Ações como fonte canônica; somente trechos necessários seguem para APIs de inferência aprovadas para o produto. Antes de habilitar cada provedor, verificar suas condições efetivas de tratamento, retenção e uso dos dados. Não prometer processamento local ou retenção zero sem comprovação.

Não copiar transcrições para consultas públicas, logs de diagnóstico ou ferramentas externas de avaliação sem tratamento adequado. Manter registros privados de fontes, versões, decisões e uso; separar métricas operacionais de conteúdo pessoal. Exclusão e correção precisam alcançar índices, memórias e interpretações derivadas, preservando apenas o necessário à política aplicável.

Usar trabalhos retomáveis, deduplicação, observabilidade de progresso e alertas de revisão atrasada. Relatórios devem mostrar cobertura real. Implantação gradual por configuração reversível, com testes de isolamento, memória, ferramentas e navegador, incluindo persistência após recarregar e comportamento em produção. Rollback de código não deve apagar correções pessoais feitas depois da implantação.

## Ordem de execução proposta

1. Montar os casos de referência e corrigir cobertura/atribuição de fontes.
2. Implementar memória temporal, recuperação e investigação com ferramentas.
3. Validar o núcleo de ponta a ponta com perguntas difíceis e sequências de correção antes de ampliar funcionalidades.
4. Fechar acompanhamento de decisões, integração com tarefas e cadência dentro do Ações.
5. Comparar modelos e revisão adicional; promover a configuração com melhor resultado por tarefa.
6. Implantar gradualmente, verificar em produção e acompanhar regressões e resultados ao longo do uso.

O compromisso de qualidade é não aceitar uma perda detectada para economizar e manter meios de detectar, corrigir e reverter falhas. Nenhum modelo ou arquitetura permite prometer perfeição permanente.

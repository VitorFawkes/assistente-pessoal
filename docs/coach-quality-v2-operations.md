# Coach v2 — operação

O coach aparece dentro do Ações, em `/coach`. A conversa continua sendo a entrada principal; Memória permite corrigir interpretações, pausar, concluir e substituir objetivos. Ajustes controla a cadência. Os acompanhamentos são gravados no próprio Ações, sem enviar mensagens a outras pessoas.

## Provedores e processamento

- `COACH_PROVIDER=openai` e `COACH_MODEL=gpt-5.6-sol`: configuração publicada e validada por chamadas reais com dados sintéticos. Sol usa Responses; decisões complexas e verificação de evidências usam esforço alto. Conversas simples usam esforço médio na geração.
- `OPENAI_API_KEY`: somente no servidor. `COACH_SEMANTIC_ENABLED=true` habilita embeddings `text-embedding-3-small`; `COACH_AUDIT_ENABLED=true` grava metadados de uso sem prompts/respostas.
- Sem `COACH_REVIEW_PROVIDER`/`COACH_REVIEW_MODEL`, a segunda revisão usa o mesmo modelo. Para outro revisor, ambos precisam ser explícitos, com a credencial do provedor correspondente. Não existe fallback silencioso.
- Anthropic/Opus e Kimi possuem adapters e testes de contrato; precisam de chaves próprias e validação real antes de promover. Astra e Fable são bloqueados em todos os papéis e na avaliação.
- `store:false` desativa armazenamento de objetos de resposta na OpenAI; não promete retenção zero pelo provedor. Somente dados necessários à conversa/leitura são enviados. Dados do usuário, fontes, índice e jobs ficam separados por RLS e filtros explícitos.

## Rotinas e recuperação

O runner existente chama a API interna a cada 15 minutos. Ele agenda leituras, revisões e acompanhamentos de perfis habilitados. O horário escolhido não promete resposta instantânea: fila e provedor acrescentam latência.

As cadências novas começam desativadas por padrão para outras contas. Foco da manhã e fechamento da noite têm janelas de três horas; alerta durante o dia exige um sinal concreto e evita repetição recente. O usuário pode pausar tudo ou cada modalidade nos Ajustes. A revisão semanal consulta os relatórios/resumos existentes de todas as reuniões do período e tarefas, sem esperar uma releitura integral das transcrições. Falas originais são consultadas seletivamente quando forem necessárias para esclarecer uma decisão ou sustentar uma observação solicitada. A cobertura distingue relatório disponível de análise comportamental aprofundada.

Pedidos têm identidade persistente, lease renovável e limite de três tentativas de recuperação. Fechar/recarregar a tela não apaga o pedido. Falhas aparecem com retomada/dispensa; cancelamento invalida gravações antigas. Um recibo transacional impede reescolher outra meta após crash posterior à alteração. Um passo concreto assumido na conversa pode ser acompanhado sem criar tarefa. Uma tarefa só é criada quando solicitada explicitamente, junto do compromisso correspondente. Relatos de obstáculo ou avanço parcial preservam estado e datas da tarefa. Conclusão exige declaração inequívoca sobre um combinado identificado.

O índice semântico combina candidatos com busca textual e leitura original. Citações, autoria, hash e período são conferidos novamente. A revisão de evidências não substitui a correção do usuário nem comprova eficácia longitudinal. A agenda Microsoft principal pode ser lida pela ponte privada do TTARS, quando configurada para a conta. Eventos são planos, não prova de presença ou entrega; calendários exclusivos do Mac e conversas dos agentes fora do Ações não entram. Configuração, pausa e limites em `docs/coach-calendar-integration.md`.

## Publicação

Aplicar migrations aditivas `0029`, `0030`, `0031`, `0032`, `0033`, `0034` após backup privado validado; atualizar frontend por imagem SHA e runner Python preservando env/config/cron existentes. Reverter imagem/config em falha de rollout, mantendo tabelas e dados novos. Evidências específicas da versão publicada serão registradas em `docs/coach-deployment.md`.

Relatórios existentes têm identidade própria, vinculada também à versão da transcrição. Mudanças invalidam respostas e revisões derivadas, inclusive quando uma ferramenta consulta um relatório fora do período principal. Mensagens novas sem reuniões preservam continuidade; legado sem rastreabilidade não é reapresentado como contexto atual. Somente reuniões sem relatório/resumo entram no fallback de análise automática.

A verificação de qualidade reprova qualquer pendência material, inclusive prazo passado e execução inferida de intenção. Há uma única reescrita sem novas ferramentas, seguida de nova verificação; segunda reprovação não publica nem realiza ações. A lease de perfil e a dos jobs são de 15 minutos. Interrupções mantêm recuperação/idempotência, sem prometer resposta instantânea.

## Continuidade das fontes — preparado em 21/09/2026

Conversas e revisões novas preservam também as referências das orientações anteriores fornecidas ao modelo, incluindo fingerprints dos períodos consultados. Corrigir um relatório ou acrescentar uma reunião em um período herdado invalida as orientações dependentes. Versões conflitantes não são descartadas para forçar uma gravação. A migration aditiva `0034_coach_context_lineage.sql` é necessária antes do frontend. Registros antigos continuam no histórico, mas orientações sem rastreabilidade completa não são tratadas como contexto atual.

Esta correção está validada em testes unitários e revisão estática; a prova de persistência/concorrência em Postgres e a publicação desta versão continuam pendentes. O teste de navegador isolado `frontend/scripts/coach-offline-browser-qa.cjs` usa os componentes reais e uma API em memória: não prova autenticação nem persistência real.


## Coach pessoal — candidato de 21/09/2026

O acompanhamento se concentra em conhecer objetivos e dificuldades declarados, ajudar a priorizar, combinar um próximo passo, perguntar pelo resultado e ajustar a orientação. As cinco capacidades do modelo Stanford são referência; os seis rótulos internos são uma adaptação. Treino de reuniões/1:1, avaliação da percepção do time e monitoramento de agentes não fazem parte da rotina. Agenda é contexto somente de leitura.

- Acordos concretos e explícitos, como “Vou enviar a proposta”, usam `track_commitment`, sem tarefa ou evento. Aceites vagos não autorizam uma alteração ambígua. O prazo não é inventado: datas estruturadas exigem ISO literal; um acordo sem data continua disponível para retomada na conversa e no fechamento.
- `report_commitment_outcome` guarda o relato literal de progresso ou obstáculo, preservando status e tarefa. A escolha do compromisso é revalidada pelo servidor; relatos ambíguos exigem esclarecimento. Repetir o mesmo pedido não duplica a gravação.
- Um compromisso aberto com prazo atingido pode motivar retomada durante o dia, mesmo sem reunião. Isso é motivo para perguntar, nunca prova de descumprimento. Preferências, intervalo de quatro horas, janela local e máximo de um nudge por dia permanecem.
- A revisão também funciona só com objetivos, contexto, memórias, conversas e acordos. Mudanças nos acordos e relatos próprios atualizam sua versão. Mensagens geradas pelo coach não contam como relato novo.
- Alterações de compromisso incrementam a revisão do perfil e invalidam gravações antigas concorrentes; o job responsável pela própria mudança avança junto. Resultados de uma tarefa continuam identificados como estado do registro, sem comprovar qualidade ou impacto da entrega.

Validação necessária antes da promoção: suíte unitária, TypeScript/lint, integrações Postgres com duas contas, navegador sintético desktop/mobile, build e cenários reais de provedor exclusivamente sintéticos em `personal-coach.provider.test.ts` (`COACH_PERSONAL_TEST=1`). Depois, verificar migrations, configuração, interface autenticada e uma execução da rotina em produção. Testes desativados ou respostas simuladas não demonstram comportamento real do modelo.

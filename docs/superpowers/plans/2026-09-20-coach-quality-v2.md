# Coach quality v2 — execução
Status: publicada no SHA1346cb8; testes locais/CI e interface em produção passaram. Teste real de IA e retomada do cron aguardam a confirmação exigida pela revisão automática de permissões. Astra/Fable excluídos.
Checkout: /Users/vitorgambetti/.codex/worktrees/coach-quality-v2/AssistentePessoal
Branch: codex/coach-quality-v2

## Restrições globais
- RLS + filtro explícito por usuário em toda nova ferramenta, índice, memória e job.
- Nenhuma chamada a Astra/Fable, inclusive testes/fallback.
- Chaves fora de cliente/logs; modelos sem credencial permanecem indisponíveis.
- UI simples centrada na conversa; observação, hipótese e fonte separadas.
- Metas vigentes e correções duráveis; ausência de registro não comprova inatividade.
- Não modificar dados de produção para testar com fixtures; usar bancos locais coach_test/coach_qa.
- Não incluir arquivos pessoais/untracked da raiz no commit.
- Implementação autorizada até publicação e teste em produção; não solicitar aprovações já dadas.

## Entregas e ownership
1. Providers/loop de ferramentas: implement_providers; model.ts/provider*.ts e testes.
2. Memória temporal e compromissos: inspect_runtime; store/types,0029,memory-policy,coach-commitments e testes.
3. Jobs/cadência/API/UI/runner: inspect_deploy;0030,jobs,rotas,componentes,ops runner e testes.
4. Evidências, investigação, índice híbrido, orquestração e avaliações: root; evidence/service/framework,0031,retrieval/investigation/evals.
5. Integração, revisão independente, testes banco/build/browser e produção: root coordena.

## Plano de verificação
- Baseline:31 testes/82 asserts, zero falhas (20/09).
- Testes de regressão antes de alterações: fala longa entre partes, diversidade, pergunta de continuidade, janelas temporais, correção antiga.
- Contratos de provedores mockados sem credenciais reais; erro/cancelamento/schema/limites.
- Postgres local com duas identidades: RLS, idempotência, lifecycle/correção, jobs/leases, compromissos/eventos.
- Avaliações sintéticas e sequências históricas; chamadas reais somente com provedor disponível e registro de limites.
- Typecheck/lint/build; browser desktop/mobile: enviar, esperar, recarregar, corrigir meta, tarefas, evidências.
- Publicação por imagem SHA, migrações aditivas com backup privado, checks de configuração e rollback de imagem.
- QA produção com sessão autorizada: conversa persistida, modelos efetivos, fontes e runner; não inventar prova de qualidade longitudinal.

## Progresso
- Base lida, memória consultada sem resultados pertinentes.
- Checkout isolado criado; dependências existentes reutilizadas.
- Produção confirmada no SHA37c00ef, somente chave OpenAI disponível. Chave Anthropic solicitada sem bloquear implementação.
- Contratos de módulos combinados entre agentes.

## Integração verificada antes do PR
- Adapters explícitos OpenAI Responses (Sol/5.5), Chat (5.1), Anthropic e Kimi; Astra/Fable bloqueados antes de qualquer fetch. Sem fallback silencioso.
- Investigação limitada por ferramentas somente leitura; trechos, hashes e autoria conferidos. Fonte corrigida veta hipóteses equivalentes; revisão de evidências alcança a prosa inteira.
- Memória temporal e recibos transacionais, compromissos aceitos ligados a tarefas, fila persistente com leases/retry/cancelamento e cadências opt-in.
- Índice semântico tenant-scoped e telemetria sem prompts; reset remove derivados e impede repopulação de chamadas antigas.
- 309 testes unitários passaram; 31 integrações Postgres passaram (257 assertivas); 10 verificações dos runners, TypeScript, lint e build local passaram. Os testes opt-in não são contados como executados pela suíte unitária.
- QA navegador: 25 verificações sem IA passaram em desktop/mobile; conversas reais em validação.
- Avaliação sintética encontrou falhas de horário/verbosidade. Horários locais agora são calculados no servidor; regex de interrogação removida. Atribuição indevida é bloqueada no servidor. Relatório de falhas e nova rodada preservados separadamente.
- Backup privado de banco e configuração criado. Publicação e checks de produção ainda pendentes nesta versão do documento.

## Ajustes encontrados no uso real
- Meta nova fica separada da frase de autorização: "substitua por esse" nunca vira objetivo. Uma meta ativa correta e histórico anterior preservado foram conferidos no banco e na interface.
- Pedidos de alteração com aconselhamento preservam a orientação verificada e acrescentam a confirmação escrita pelo servidor somente depois de persistir.
- Conversa de priorização, tarefa com responsável/prazo, correção de memória e meta com próximo passo passaram com Sol real em banco sintético.
- UI compactada no celular; resposta de job assíncrono acompanha o scroll sem arrastar quem está lendo o histórico.
- Scheduler ignora usuários sem trabalho ao contar seu limite de workers.
- Migrations0029–0031 aplicadas em produção após backup validado; RLS forçada e isolamento real conferidos. A imagem antiga permanece até terminar a validação desta entrega.
- Correção de memória passa a invalidar o trecho citado e a interpretação, sem inutilizar outras falas da reunião. Revisão semanal admite uma ressíntese completa e limitada, seguida de nova verificação.
- Suíte final:330 testes unitários passaram,49 opt-in ignorados,zero falhas; banco31/31 integrações na entrega (20 delas repetidas após ajuste de memória),runners10/10,TypeScript e lint limpos.
- QA adicional:9/9 verificações em conversa real com troca de meta e orientação; autoscroll assíncrono2/2 sem IA.

## Publicação verificada
- PR#5 integrado; imagem1346cb838f3c6f79b990691b2a1428165c4351be efetiva e persistente no Easypanel.
- Replay semanal12/12 e smoke produção somente leitura16/16 passaram. Conversa nova com dados reais não foi executada:duas rejeições do controle automático; confirmação pendente.
- Cron preservado e pausado durante essa pendência; runner atualizado com configuração válida. O histórico precisa ser reprocessado com o hash novo.

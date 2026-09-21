# Coach quality v2 — execução
Status: em implementação; proposta aprovada pelo usuário, Astra/Fable excluídos.
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

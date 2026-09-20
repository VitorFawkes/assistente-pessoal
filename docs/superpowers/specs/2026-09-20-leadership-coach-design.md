# Coach pessoal de liderança — Ações

## Objetivo e autorização
Pedido do Vitor: pesquisar, planejar, implementar, testar e publicar sem interromper para decisões técnicas. Novo subsistema arquitetural; esta autorização substitui os checkpoints interativos das skills. Entregar coaching profissional privado baseado em atuação observável, não diagnóstico psicológico ou avaliação oficial Stanford.

## Decisão
Adicionar `/coach` ao Next.js existente, reaproveitando sessão, `withTenant`, reuniões, tarefas, pessoas e identidade de speaker. O assistente existente depende de bridge WebSocket no Mac fora deste repositório; permanece funcional. Coach usa API de IA no servidor (chave existente, `store:false`), memória e conversas no Postgres. Sem ferramentas de escrita em tarefas, envio a colegas, consulta web com contexto pessoal ou compartilhamento público. Revisão proativa dentro do Ações, semanal em horário de São Paulo; cron no VPS executa análise incremental e geração. Outros usuários precisam ativar explicitamente.

Alternativas: estender bridge exigiria Mac sempre ligado e não há fonte no repo; workflow n8n inteiro duplicaria autenticação e UI. Runtime no servidor mantém o isolamento e a persistência no mesmo contrato.

## Dados e aprendizagem
Tabelas RLS: `coach_profiles`, `coach_memories`, `coach_messages`, `coach_analyses`, `coach_reviews`. Perfil editável com objetivos/contexto, dia/hora/fuso e ativação. Memória tem tipo, estado (hipótese/confirmada/rejeitada), fonte e histórico de correção. Nunca promover inferência automaticamente a fato. Conversas persistentes; chat recupera memória e fontes relevantes do histórico completo por busca, com limites explícitos.

Reuniões finalizadas são analisadas em lotes retomáveis. Texto completo dividido em partes determinísticas; hash inclui transcrição/atribuição de speaker. Índice único usuário/reunião/hash/parte evita duplicação. Cobertura distingue total, partes processadas e reuniões concluídas. Nenhum limite silencioso às últimas 100 reuniões. Pais arquivados excluídos para evitar contagem dupla. Reanalisar ao corrigir transcrição/speakers. Inferências exigem citações literais verificadas no servidor; speaker não confirmado significa observação da reunião, não conduta atribuída ao usuário. Texto de reunião e memória são dados não confiáveis, nunca instruções.

Revisão semanal: foco principal, observações, hipóteses, contraprovas/limitações, um experimento e pergunta. Referências vinculadas às reuniões/partes e data. Comparar semanas sem notas pseudoquantitativas. Não inventar agenda conectada: usar compromissos de tarefas e reuniões registradas; agenda externa não está disponível. Históricos do bridge externo também não estão disponíveis; novas conversas do coach são persistidas.

## Interface
Warm paper/Fraunces/Geist já usados no site. Visão inicial curta: revisão semanal e principal foco; abas Conversa, Memória e Referenciais. Configuração editável, pausa, exclusão do histórico do coach, confirmação/correção/rejeição de interpretações. Estados de análise parcial, IA indisponível e ausência de reuniões explícitos. Mobile 390px, teclado, erros legíveis, persistência após reload.

## Privacidade e operação
Isolamento RLS + filtros explícitos em queries coach; APIs de usuário só aceitam user da sessão. Runner separado com segredo forte e usuário derivado de configuração ativada, não body arbitrário. Leases transacionais, erros recuperáveis e execução semanal idempotente. Modelo recebe apenas contexto necessário via API já utilizada pelo produto; `store:false` não promete retenção zero do provedor. Segredos/transcrições fora dos logs. Exclusão do coach não remove reuniões/tarefas. Mudanças no perfil durante geração invalidam gravação obsoleta.

## Aceitação
Testes de chunking sem perda, validação literal de evidências, speaker, calendário semanal/fuso, isolamento real entre dois tenants e idempotência. Build/typecheck/lint das mudanças; suite existente; navegador desktop/mobile para chat, memória, configurações, evidências e reload. Chamada real ao provedor e teste do runner; implantação com rollback para imagem anterior. Relatório distingue provas técnicas de qualidade longitudinal, que depende do uso.

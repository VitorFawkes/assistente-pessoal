# Coach v2 — operação

O coach aparece dentro do Ações, em `/coach`. A conversa continua sendo a entrada principal; Memória permite corrigir interpretações, pausar, concluir e substituir objetivos. Ajustes controla a cadência. Os acompanhamentos são gravados no próprio Ações, sem enviar mensagens a outras pessoas.

## Provedores e processamento

- `COACH_PROVIDER=openai` e `COACH_MODEL=gpt-5.6-sol`: configuração candidata validada por chamadas reais. Sol usa Responses; decisões complexas e verificação de evidências usam esforço alto. Conversas simples usam esforço médio na geração.
- `OPENAI_API_KEY`: somente no servidor. `COACH_SEMANTIC_ENABLED=true` habilita embeddings `text-embedding-3-small`; `COACH_AUDIT_ENABLED=true` grava metadados de uso sem prompts/respostas.
- Sem `COACH_REVIEW_PROVIDER`/`COACH_REVIEW_MODEL`, a segunda revisão usa o mesmo modelo. Para outro revisor, ambos precisam ser explícitos, com a credencial do provedor correspondente. Não existe fallback silencioso.
- Anthropic/Opus e Kimi possuem adapters e testes de contrato; precisam de chaves próprias e validação real antes de promover. Astra e Fable são bloqueados em todos os papéis e na avaliação.
- `store:false` desativa armazenamento de objetos de resposta na OpenAI; não promete retenção zero pelo provedor. Somente dados necessários à conversa/leitura são enviados. Dados do usuário, fontes, índice e jobs ficam separados por RLS e filtros explícitos.

## Rotinas e recuperação

O runner existente chama a API interna a cada 15 minutos. Ele agenda leituras, revisões e acompanhamentos de perfis habilitados. O horário escolhido não promete resposta instantânea: fila e provedor acrescentam latência.

As cadências novas começam desativadas por padrão para outras contas. Foco da manhã e fechamento da noite têm janelas de três horas; alerta durante o dia exige um sinal concreto e evita repetição recente. O usuário pode pausar tudo ou cada modalidade nos Ajustes. A revisão semanal depende do material do seu próprio período, sem esperar todo o histórico antigo.

Pedidos têm identidade persistente, lease renovável e limite de três tentativas de recuperação. Fechar/recarregar a tela não apaga o pedido. Falhas aparecem com retomada/dispensa; cancelamento invalida gravações antigas. Um recibo transacional impede reescolher outra meta após crash posterior à alteração. A tarefa aceita e o compromisso correspondente são criados juntos.

O índice semântico combina candidatos com busca textual e leitura original. Citações, autoria, hash e período são conferidos novamente. A revisão de evidências não substitui a correção do usuário nem comprova eficácia longitudinal. Agenda externa e conversas dos agentes fora do Ações não estão conectadas.

## Publicação

Aplicar migrations aditivas `0029`, `0030`, `0031` após backup privado validado; atualizar frontend por imagem SHA e runner Python preservando env/config/cron existentes. Reverter imagem/config em falha de rollout, mantendo tabelas e dados novos. Evidências específicas da versão publicada serão registradas em `docs/coach-deployment.md`.

A mudança no hash de fonte inclui data e versão de extração. Análises antigas tornam-se pendentes para nova leitura; isso não apaga reuniões nem objetivos. A conversa pode investigar fontes originais enquanto o histórico é reprocessado. O backfill existente é sequencial e limitado por tempo/ticks.

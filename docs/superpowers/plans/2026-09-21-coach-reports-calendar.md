# Coach: relatórios existentes e agenda pessoal

Status: implementação autorizada; publicação e prova em produção fazem parte da entrega.

## Resultado esperado

A conversa continua sendo a entrada principal. O coach conhece os relatórios e tarefas das reuniões do período, consulta falas originais quando precisa sustentar uma avaliação comportamental e compara compromissos planejados na agenda com os registros disponíveis. Um evento na agenda não comprova presença, trabalho realizado ou falta de foco.

## Contratos

- `executive_summary` é contexto gerado, não citação primária. Relatório e transcrição possuem identidade/versionamento; uma edição invalida conclusões derivadas. Relatórios ausentes não são escondidos nem confundidos com reuniões sem conteúdo.
- Todos os relatórios elegíveis do período entram na seleção, com limites de tamanho explícitos. Avaliação comportamental exige fonte original, autoria verificável e as correções do usuário. A cobertura de relatórios fica separada da leitura comportamental.
- A agenda usa a conexão Microsoft já autorizada no TTARS. Credencial dedicada entre servidores, presa a um único dono e organização; o Ações também prende a integração à conta correspondente. Nenhum token Microsoft é transferido ao Ações.
- TTARS separa captura operacional (`coach-calendar-sync`) e exportação da Base Única preparada (`coach-calendar-read`). O leitor não acessa Graph nem tabelas operacionais. Ambos autenticam antes de qualquer acesso.
- Janela máxima de 31 dias, preparo/cache de 15 minutos, falhas e incompletude explícitas. Nenhuma resposta indisponível significa agenda livre. Pausa/exclusão invalidam cache e gravações em andamento.
- Sem alteração de eventos, emails ou mensagens externas. Segredos, dados e capturas pessoais ficam fora dos repositórios.
- Modelo e regras de qualidade existentes preservados: Sol, sem Astra/Fable e sem redução silenciosa da qualidade.

## Execução

1. Relatórios: ampliar consultas/tipos, seleção e cobertura; preservar ferramentas de leitura original, correções e verificação de evidências; ajustar jobs e revisões semanais.
2. TTARS: implementar credencial vinculada, captura mínima, ingestão raw, preparo e leitor restrito; provar paridade, isolamento, revogação e indisponibilidade.
3. Ações: cache com RLS, consumidor servidor, contexto de agenda e controle simples em Ajustes; impedir chamadas por polling de tela.
4. Validar: testes unitários, Postgres real isolado, contrato de fontes TTARS, tipos/lint/build, modelo com dados sintéticos e navegador desktop/celular.
5. Publicar migrations aditivas após backup, endpoints TTARS e imagem Ações por SHA; configurar credencial privada. Provar agenda real, falhas de acesso, contexto/reload e rotina proativa em produção.
6. Registrar evidências e limites reais em documentação operacional. Não confundir sucesso técnico com eficácia longitudinal de coaching.

## Reversão

Desativar a integração via configuração ou UI e retornar à imagem anterior preserva reuniões, tarefas e memória. Revogar a credencial dedicada fecha a ponte. Não remover dados/tabelas no rollback.

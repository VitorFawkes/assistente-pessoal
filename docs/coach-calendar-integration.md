# Agenda privada do coach pelo TTARS

O coach consulta o calendário principal da Microsoft já autorizado no TTARS. Calendários secundários e eventos existentes somente no Mac não fazem parte desta conexão. Agenda é planejamento: o coach não pode usá-la como prova de presença, trabalho realizado, eficácia ou disponibilidade de um espaço vazio.

## Contrato e configuração

No servidor Ações, definir `COACH_TTARS_CALENDAR_BASE_URL` (HTTPS terminando em `/functions/v1`), `COACH_TTARS_CALENDAR_TOKEN` e `COACH_TTARS_CALENDAR_USER_ID` (UUID Ações do dono verificado). Nenhuma dessas variáveis usa `NEXT_PUBLIC_`. Credenciais OAuth Microsoft permanecem no TTARS; o segredo dedicado é vinculado no TTARS a um único dono e organização. O cliente não escolhe dono nem URL.

1. `POST <base>/coach-calendar-sync`, JSON estrito `{from,to}`, captura Microsoft e prepara a geração na Base Única do TTARS.
2. `GET <base>/coach-calendar-read?from=...&to=...` lê somente a geração preparada.

Ambos exigem `Authorization: Bearer <segredo dedicado>`. Sync devolve `{version:1,status,from,to,updated_at,limitations}`. Read acrescenta `events` com `id,subject,start,end,is_all_day,show_as,is_private`. `updated_at` do sync é o timestamp da captura persistida, e precisa representar o mesmo instante no read. Nunca aceitar uma resposta HTTP 200 do sync como sucesso sem verificar o status. Falha/reconexão não autoriza reutilizar uma geração antiga.

Limites: 31 dias por pedido, 1.000 eventos, 15 minutos de validade. Consultas de coaching maiores continuam com uma limitação explícita de agenda. Eventos de dia inteiro não são convertidos em compromissos de horário fixo.

## Cache e privacidade

Aplicar `db/0032_coach_calendar_cache.sql` antes do frontend. Uma linha por usuário; RLS obrigatória inclusive para o dono da tabela. Todas as operações usam `withTenant`. A migração é aditiva e repetível.

`calendarStatus` é uma leitura local, sem Microsoft ou TTARS; o polling da interface não sincroniza agenda. `calendarContext` reaproveita uma leitura válida que cubra o período e, se necessário, sincroniza antes de ler o preparado. A janela padrão cobre ontem, hoje e os próximos sete dias completos no fuso do perfil. Seus limites UTC correspondem ao início de cada data local, respeitando horário de verão e datas em que a meia-noite não existe. Cada evento temporizado também recebe sua data local com fuso explícito.

Uma lease de dois minutos evita atualizações concorrentes, com falhas limitadas por intervalo de um minuto. O botão manual aceita no máximo duas tentativas por minuto. Cada resultado é gravado somente se a revisão do perfil, a lease e o estado ativo ainda forem válidos. Pausar a agenda elimina sua cópia local; pausar o coach também elimina eventos copiados, preservando a preferência separada. Apagar o coach remove a linha; respostas HTTP em voo não podem restaurá-la. A conexão TTARS e os eventos originais não são apagados.

Interface: **Coach → Ajustes → Sua agenda, junto das suas prioridades**. Mostra conexão, última leitura, pausa e atualização. Não expõe títulos da agenda no estado público da API nem credenciais. O conteúdo é usado internamente nas respostas privadas do coach.

## Verificação

`bun --no-env-file test lib/coach/calendar.test.ts` verifica limites, contrato, falhas, status de reconexão, datas, geração, cache, outro usuário, pausa e exclusão durante atualização. Com `COACH_TEST_DATABASE_URL` apontando exclusivamente para Postgres local `coach_test`, `calendar.integration.test.ts` cria e remove um schema sintético isolado para provar RLS, bloqueio de escrita cruzada, lease e invalidação.

Regressões de interface para verificar no navegador: editar objetivos e contexto sem salvar, alternar a agenda e conferir que ambos os rascunhos permanecem; salvar e reabrir para conferir persistência. Com relatórios disponíveis e zero trechos analisados, “Preparar revisão” deve estar habilitado. Sem relatórios nem trechos analisados, permanece desabilitado e orienta completar o contexto faltante.

Em produção, verificar usuário vinculado, conexão ativa e consentimento existentes no TTARS antes de configurar. Validar sync/read com dados privados sem imprimir assuntos ou token nos logs; conferir igualdade de geração, estado na interface e negação para outra conta. Publicação e resultado dos testes reais devem constar no registro da entrega, não são presumidos por este documento.

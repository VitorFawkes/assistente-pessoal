# Medidor de custo do Coach

Mostra quanto cada resposta do Coach custa **antes** de uma mudança ir ao ar, sem gastar com IA.

Ele repete conversas reais numa cópia local do banco (pglite), troca a OpenAI por uma resposta
falsa e conta os tokens exatos de cada pedido no contador gratuito da OpenAI
(`/v1/responses/input_tokens`). Sai uma tabela por cenário: cada chamada (principal, verificador,
leitor de tarefas), o custo de entrada e as partes do pacote que mais pesam.

## Rodar

1. Tirar um dump do banco de produção (fica fora do repositório; tem dados reais):

   ```bash
   ssh <vps> "docker exec <container do assistente-pessoal-db> sh -c 'PGPASSWORD=\$POSTGRES_PASSWORD pg_dump -U assistente -d assistente_pessoal --no-owner --no-acl --inserts --exclude-table-data=tarefa_anexos --exclude-table-data=sessions --exclude-table-data=invites --exclude-table-data=audit_log'" \
     | grep -v '^\\restrict\|^\\unrestrict' > /caminho/privado/prod-dump.sql
   ```

2. Ter um arquivo de cenários **privado** (não commitar: aponta para mensagens reais):

   ```json
   [
    {"nome": "manha", "tipo": "checkin", "checkin": "morning", "agora": "2026-09-25T08:00:40-03:00"},
    {"nome": "pedido", "tipo": "chat", "mensagem_chave": "<idempotency_key da mensagem do usuário>", "agora": "2026-09-25T09:07:52-03:00"},
    {"nome": "livre", "tipo": "chat", "mensagem": "Como organizo hoje?", "agora": "2026-09-25T10:00:00-03:00"},
    {"nome": "revisao", "tipo": "revisao", "agora": "2026-09-25T17:00:00-03:00"}
   ]
   ```

   O do Vitor fica em `~/.acoes/evals/coach-custo-cenarios.json`.

3. Rodar (lê as variáveis `COACH_*` do serviço em produção, sem imprimir segredos):

   ```bash
   DUMP=/caminho/privado/prod-dump.sql CENARIOS=~/.acoes/evals/coach-custo-cenarios.json ./ops/eval/coach-custo/medir.sh --limite 70000
   ```

   - `--so <nome>` roda um cenário só; `--saida arquivo.json` guarda o relatório.
   - `--limite N` faz o comando falhar se algum cenário passar de N tokens de entrada.

A cópia volta à hora de cada cenário: mensagens, memórias, combinados e revisões criados depois
são apagados dela, e o registro de gasto é zerado para a repetição não esbarrar no teto diário.

## Números de referência (25/09/2026, GPT-6 Sol)

| Cenário | Antes | Depois |
|---|---|---|
| Check-in das 8h | 129.920 tokens | 44.228 tokens |
| Fechamento das 18h | 176.624 | 57.462 |
| "Oi" | 161.553 | 60.723 |
| Pedido de limpar as atrasadas | 186.371 | 63.278 |
| Revisão de sexta | 143.843 | 60.777 |

Antes, cada pedido ainda pagava 25% a mais por ir inteiro para o cache (escrita automática do
GPT-5.6 em diante) e quase nunca era reaproveitado; agora o Coach pede cache explícito sem pontos
de gravação.

## Assistente + Coach (25/09, pedido do Vitor: "o agente assistente inteligente que acha tudo que preciso; o Coach pede dados pra ele")

Toda mensagem passa pelo leitor de pedidos de tarefa (GPT-6 Sol), que aplica mudanças e escolhe o caminho:

- **Assistente** (informação: tarefas, pessoas, reuniões, prazos, agenda): o planejador (`planner.ts`, GPT-6 Luna)
  escolhe até 4 buscas fixas; o servidor roda (`finder.ts`, SQL, sem IA); o assistente (`assistant.ts`, GPT-6 Luna)
  responde a partir do dossiê. Sem conferente.
- **Coach** (conselho, prioridades, objetivos): o mesmo planejador busca o que a conversa precisa e o Coach (GPT-6 Sol)
  lê o dossiê, sem ferramentas e sem o pacote grande. O conferente lê o mesmo dossiê.
- **Check-ins** (8h, 18h, cobrança, pós-reunião): lista fixa de buscas, sem planejador.

No arquivo de cenários, `"consultas": [...]` (refs `p0`, `r0` como o planejador de verdade) é o plano que o planejador
falso devolve.

## Dois caminhos (25/09, pedido do Vitor: "quando ele é coach pode ser o caro, mas pras tarefas não dá")

O leitor de pedidos de tarefa (GPT-6 Sol, ~US$ 0,008) também classifica cada mensagem:

- **tarefas** (concluir, adiar, criar, listar, limpar atrasadas, "o que tenho hoje", "o que falta com a Paula"):
  resposta pelo caminho barato (`frontend/lib/coach/quick-answer.ts`), GPT-6 Luna, pacote pequeno
  (lista das atrasadas, tarefas ligadas à mensagem, agenda do dia), sem conferente. ~8.500 tokens,
  **~US$ 0,008 no total**.
- **coach** (conselho, prioridades, objetivos, desabafo): o caminho completo, com o conferente (~US$ 0,10–0,40).

No arquivo de cenários, `"caminho": "tarefas"` faz o intérprete falso mandar o chat pelo caminho barato.
Testes pagos de 25/09: separação tarefas × coach 24/24 (US$ 0,14); 50 frases de pedidos de tarefa 50/50 (US$ 0,30).

## O que fica no ar (não é só medição)

- **Pacote enxuto** (`frontend/lib/coach/context-budget.ts`): últimas 12 mensagens, 40 tarefas,
  20 eventos, até 10 relatórios de reunião, agenda sem códigos internos, sem hashes de linhagem.
  O resto o Coach lê com as ferramentas quando precisa. Teste que trava o tamanho:
  `service.test.ts` → "the package a chat sends stays bounded".
- **Custo de cada chamada** gravado em `coach_model_runs.cost_usd` (migration `db/0040`), com os
  preços em `frontend/lib/coach/pricing.ts`.
- **Teto diário** (`frontend/lib/coach/budget.ts`, `COACH_DAILY_BUDGET_USD`, padrão US$ 3): passou
  do teto, o Coach não chama mais a IA até o dia seguinte; a resposta que cruza o teto avisa, as
  seguintes recebem uma recusa curta, e revisão/análise agendadas ficam para 00h05.

## Teste com IA de verdade

Comparar a qualidade exige chamar o modelo (custa). Regra do Vitor: teste pago acima de US$ 5
(soma das rodadas) só com o ok dele e com a estimativa antes. Em 25/09 o antes × depois em 3
conversas custou US$ 4,60 no total.

# Planos como visão de Quadro — Design

**Data:** 2026-07-07
**Objetivo:** Permitir múltiplos planos (hoje só existe 1 via `tarefas.no_plano`) e transformar um quadro em um plano.

## Decisão central

Não criar entidade `planos`. **Um "plano" é um quadro visto como linha do tempo (Gantt).**
Cada quadro passa a ter duas visões:

- **Lista** — o `TaskBoardView` atual (compartilhável com convidados).
- **Linha do tempo** — o `PlanoTimeline` atual (Gantt), alimentado com as tarefas daquele quadro.

Escolhido pelo usuário entre 3 opções (unify vs entidade separada snapshot vs espelho). Ganhou **unify**.

### Modelo enxuto (o que muda de fato)

O `/plano` de hoje **permanece inalterado**: é a timeline pessoal privada do dono, baseada em `tarefas.no_plano`. É o item "Plano" do menu (mantido — decisão 3a).

O que muda: **cada quadro ganha o toggle Lista ↔ Linha do tempo.** Então:
- "Múltiplos planos" = o `/plano` pessoal **+** qualquer quadro aberto como timeline. Cada quadro é um plano em potencial.
- "Transformar quadro em plano" = clicar "Linha do tempo" no quadro e persistir `vista_padrao='timeline'` (reversível).

Isso evita migração de dados, dual-write `no_plano`↔membership e o problema de "de onde o modal de gerenciar tira as tarefas". `no_plano` e `/plano` ficam intocados.

## Modelo de dados (aditivo, idempotente, não-destrutivo)

Migração `db/0020_quadro_vista.sql` — **uma coluna só**:

```sql
ALTER TABLE quadros
  ADD COLUMN IF NOT EXISTS vista_padrao TEXT NOT NULL DEFAULT 'lista'
    CHECK (vista_padrao IN ('lista','timeline'));
```

- **`quadros.vista_padrao`** — 'lista' | 'timeline'. É a materialização de "transformar em plano". Quadros existentes ficam em 'lista'.
- **Ordenação por-quadro** reusa `quadro_tarefas.ordem` (já existe): a timeline de um quadro reordena nessa coluna, exposta como `quadro_ordem` na query. A mesma tarefa pode ter posições diferentes em planos diferentes.
- **`inicio`/`prazo` continuam na `tarefas`** (globais): uma tarefa tem uma data real só, independente de quantos planos a exibem.
- **`no_plano` e o `/plano` pessoal ficam como estão** — sem migração, sem tocar.

## Backend

- `lib/quadros.ts`:
  - `Quadro` += `vista_padrao: 'lista'|'timeline'`.
  - `.tarefas(quadroId)` passa a expor `qt.ordem AS quadro_ordem` (wrap do `TAREFA_SELECT` como subquery pra não colidir com `t.ordem`).
  - `.atualizar(...)` aceita `vista_padrao`.
  - novo `.reordenarTarefas(quadroId, ids)` → `UPDATE quadro_tarefas SET ordem = (idx-1)*10 FROM unnest($ids) WITH ORDINALITY WHERE quadro_id=$q AND tarefa_id=id`.
- `lib/queries.ts`: `Tarefa` += `quadro_ordem?: number | null`.
- API:
  - `PATCH /api/quadros/[id]` aceita `vista_padrao` (valida enum).
  - novo `POST /api/quadros/[id]/reorder` `{ ids }` → `.reordenarTarefas`.

## Frontend

- **`PlanoTimeline`** ganha props:
  - `quadroId?: string` — quando presente: (a) não filtra por `no_plano` (renderiza as tarefas recebidas), (b) ordena/reordena por `quadro_ordem`, (c) reordena via `POST /api/quadros/[id]/reorder`.
  - `showManageButton?: boolean` (default `true`) — o `/plano` mantém o botão "gerenciar" (abre `PlanoManageModal`, no_plano); dentro de um quadro passa `false` (o `QuadroManager` já provê criar/adicionar acima).
  - Sem `quadroId` = comportamento atual do `/plano`, intacto.
- **`QuadroManager`**: toggle **[ Lista | Linha do tempo ]** no header. Estado inicial de `quadro.vista_padrao`; trocar persiste via `PATCH` (é o "transformar em plano"). Lista = layout atual (grid tarefas + convidados/atividade). Timeline = `PlanoTimeline` full-width (quadroId, showManageButton=false), com Convidados/Atividade abaixo. Composer "nova tarefa" e "adicionar existentes" ficam visíveis nas duas visões.
- **`/quadros` (cards)**: selo "linha do tempo" quando `vista_padrao='timeline'` (cosmético).
- **`/plano`, nav "Plano", checkbox "no plano"**: inalterados.
- **Convidado (`/q/[token]`)**: só Lista. Nada muda.

## Rollout

Ordem: migração → deploy front → verificação.
- Migração via `sshpass`+`docker exec` no container `n8n_assistente-pessoal-db`, `pg_dump` antes. Aditiva (uma coluna com default) ⇒ segura antes do front; front antigo ignora a coluna.
- Front: push `main` → CI builda GHCR `:sha`; `docker service update --image ...:$(git rev-parse HEAD) n8n_assistente-frontend` no swarm.
- Verificação ao vivo: sessão temporária no DB, dirigir os fluxos (abrir quadro → Linha do tempo, reordenar, voltar pra Lista, `/plano` continua ok), DELETE da sessão depois.

## Não-objetivos

- Não tocar `/plano` nem `no_plano`.
- Sem timeline pro convidado.
- Deletar plano = arquivar o quadro (fluxo atual).
- Sem migrar `tarefa_frentes` N:N (agrupamento por frente usa `frente_id` principal, como hoje).

## Riscos

- Baixo. Migração é 1 coluna aditiva com default; front antigo não a usa. Sem dual-write, sem migração de dados. `quadro_ordem` só afeta a nova visão timeline dos quadros.

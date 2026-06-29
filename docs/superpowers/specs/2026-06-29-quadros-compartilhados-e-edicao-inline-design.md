# Quadros compartilhados (centro de controle) + edição inline de tarefas

**Data:** 2026-06-29
**Status:** Em revisão
**Escopo:** `frontend/` (UI + APIs) + `db/` (1 migration aditiva)

## Objetivo

Duas peças que se reforçam:

1. **Quadros compartilhados** — o Vitor monta um "centro de controle" (um *quadro*) com uma lista de tarefas escolhidas a dedo e gera **links por pessoa** (sem senha). Cada convidado abre o link e **adiciona, edita, conclui, reagenda e apaga** tarefas. O quadro mostra o status de cada tarefa (no prazo / hoje / vencida / feita).
2. **Edição inline** — a "caixa" de cada tarefa passa a ser **editável no próprio lugar**, lendo e trocando as infos sem abrir um pop-up. O card editável vira o componente reutilizado tanto nas páginas do Vitor quanto no quadro do convidado.

## Decisões do brainstorm (2026-06-29)

| Tema | Decisão |
|---|---|
| Escopo | **Um spec só, executado em fases.** Inline + compartilhamento no mesmo plano. |
| Acesso do convidado | **Link por pessoa, passwordless.** Cada convidado tem token próprio; ações ficam atribuídas a ele; revogável individualmente. Espelha o modelo de convite/sessão atual. |
| Conteúdo do quadro | **Lista curada manual.** O Vitor escolhe quais tarefas entram no quadro. Tarefas criadas pelo convidado entram automaticamente. |
| Permissões do convidado | **Edição total** — cria, edita qualquer campo, conclui, reagenda, **apaga de verdade** (hard delete). "Como se fosse dono", limitado às tarefas daquele quadro. |
| Multiplicidade | **Vários quadros independentes**, cada um compartilhado com pessoas diferentes. **A mesma pessoa pode estar em vários quadros** — cada quadro emite seu próprio link por pessoa (N convidados por quadro; o mesmo humano = uma entrada/link por quadro). Sem identidade global de convidado. |
| Toast/feedback | **`sonner`** (lib leve e bonita) pro feedback do salvamento otimista. Prioridade explícita do Vitor: a UI deve ser **a mais visual, bonita e clara possível**. |
| Nome | Entidade interna = `quadros` (tabelas/rotas/código). Rótulo de UI task-centric, finalizado na build (decoupled do código — troca trivial). |

### Supersede explícito

O spec `2026-05-20-tarefas-ux-inline-design.md` escolheu **manter o modal** e editar via chips/popover ("Abordagem A", rejeitando edit-in-place). O pedido atual do Vitor é o oposto: **editar no próprio card, sem pop-up**. Este spec **supersede** aquela decisão para a parte de edição. Os atalhos inline já existentes (`AcaoEditor`) são preservados e ampliados; o `TaskEditModal` é aposentado.

## Estado atual relevante

- App **Next.js 16 multi-tenant**. RLS no Postgres via `withTenant(user.id)` (`lib/db.ts`); queries de sistema (sessions/invites/users) usam `query()` direto. Convenções em `frontend/AGENTS.md`.
- Auth passwordless: admin cria `invites` → `/c/[code]` → consome (`lib/auth.ts` `consumeInvite`) → vira **tenant próprio isolado**. Token de convite = `randomBytes(16).toString("base64url")` (128 bits).
- `proxy.ts` redireciona tudo que não está em `PUBLIC_PREFIXES` pra `/sem-acesso`. Rotas com auth própria entram no allowlist.
- Tarefa (`tarefas` + joins `tarefa_pessoas`, `tarefa_frentes`): titulo, descricao, owner (texto livre), acao (`executar`/`cobrar`/`aguardar`), prazo, inicio, prazo_text, prioridade, status (`aberta`/`em_andamento`/`concluida`/`cancelada`), frente (área, N:N), pessoas (N:N), no_plano, ordem.
- `app/page.tsx` → `TasksDashboard`; `app/plano/page.tsx` → `PlanoTimeline`. Card = `components/task-row.tsx`; pop-up = `components/task-edit-modal.tsx` (a aposentar). Criação = `components/task-create-modal.tsx` + `components/capture-composer.tsx` + `lib/capture.ts`.
- Mutações da tarefa: `PATCH/DELETE /api/tarefas/[id]`, `GET/POST /api/tarefas`, `GET /api/frentes`, `GET /api/owners`. O PATCH já registra eventos de auditoria/feedback em `tarefa_eventos` + `extracao_feedback`.
- `app/layout.tsx`: o header só renderiza a nav autenticada `if (user)`. **Visitante sem sessão já vê o layout sem a nav** — o quadro do convidado herda isso de graça.

---

## Parte A — Edição inline (edit-in-place)

### A.1 Camada de mutação plugável (`TaskMutationContext`)

Hoje os componentes (`TaskRow`, `AcaoEditor`, `CaptureComposer`, `TaskCreateModal`) chamam `fetch("/api/tarefas/...")` e `router.refresh()` direto. Pra que o **mesmo card** sirva ao dono e ao convidado (que batem em endpoints diferentes), introduzimos um contexto:

```ts
// lib/task-mutations.tsx
type TaskMutations = {
  patch: (id: string, body: object) => Promise<Tarefa | null>;
  remove: (id: string, opts?: { motivo?: string }) => Promise<void>;
  create: (draft: object) => Promise<Tarefa | null>;
  listFrentes: () => Promise<{ id: string; nome: string }[]>;
  createFrente?: (nome: string) => Promise<{ id: string; nome: string } | null>; // dono só
  refresh: () => void;     // router.refresh() (dono) ou re-fetch local (convidado)
  scope: "owner" | "guest";
};
const TaskMutationContext = createContext<TaskMutations>(ownerDefault);
export const useTaskMutations = () => useContext(TaskMutationContext);
```

- **Dono** (`OwnerTaskProvider`): `patch`→`PATCH /api/tarefas/[id]`, `remove`→`DELETE`, `create`→`POST /api/tarefas` (reusa `parseCapture`/`lib/capture.ts`), `listFrentes`→`/api/frentes`, `refresh`→`router.refresh()`. Embrulha o `TasksDashboard` e o `PlanoTimeline` sem mudar comportamento.
- **Convidado** (`GuestTaskProvider`, Parte B): mesmos métodos batendo em `/api/q/[token]/...`; `refresh` re-busca a lista do quadro.

`TaskRow`/`AcaoEditor`/`CaptureComposer` passam a usar `useTaskMutations()` em vez de `fetch` hardcoded. `scope` permite esconder ações exclusivas do dono (ex: aprovar frente sugerida) no convidado.

> O `scope: "guest"` **não** é a fronteira de segurança — é só UI. A segurança real é server-side (Parte B.4). Nunca confiar no front pra autorizar.

### A.2 Card editável no lugar (expand-in-place)

`TaskRow` ganha dois modos:

- **Compacto (leitura)** — igual hoje: faixa de prioridade, círculo de concluir, título, chips de prazo/ação/área/pessoas, link de reunião. Mantém os atalhos de 1 toque.
- **Expandido (edição)** — clicar no card (fora dos controles) **expande o card no próprio lugar da lista** (empurra os vizinhos pra baixo), revelando um painel de edição inline. **Sem overlay, sem modal.** Clicar de novo no cabeçalho / `Esc` / clicar fora colapsa.

O painel expandido reusa os campos do antigo modal, renderizados inline:
título, descrição, ação + responsável, prioridade, início, prazo (+ atalhos hoje/amanhã/sexta/próx. semana/limpar), no_plano, área, pessoas, status, deletar (confirmação em 2 toques inline).

Extraímos esses campos pra **`components/task-edit-fields.tsx`** (um componente puro que recebe a tarefa + `useTaskMutations`), consumido pelo card expandido. Assim o convidado herda exatamente os mesmos campos.

### A.3 Salvamento otimista por campo

Sem botão "Salvar" (é edição direta). Cada campo salva no **blur** (inputs de texto) ou **na hora** (selects/chips/toggles), com otimismo local:

```ts
const [optimistic, setOptimistic] = useState<Partial<Tarefa>>({});
const t = { ...tarefaProp, ...optimistic };
async function mutate(patch: Partial<Tarefa>) {
  setOptimistic(p => ({ ...p, ...patch }));
  try { await mut.patch(t.id, patch); mut.refresh(); setOptimistic({}); }
  catch (e) { setOptimistic({}); toast.error(...); }   // reverte
}
```

Título vazio é bloqueado client-side (igual ao modal hoje). Erros mostram toast (introduzir `sonner` — leve, já previsto no spec antigo) e revertem o otimismo.

### A.4 Atalhos de 1 toque (sem expandir)

Permanecem/entram como quick-edits no card compacto, pra "muda data" e "conclui" serem instantâneos:
- **Círculo de status** → concluir/reabrir (já existe).
- **Chip de ação/responsável** → `AcaoEditor` (já existe; migra pro contexto).
- **Chip de prazo** → vira clicável: popover pequeno de data (hoje/amanhã/sexta/+1 semana/escolher/limpar). *(Esse popover de data é um quick-edit pontual, não o pop-up de edição geral que estamos eliminando.)*

### A.5 Aposentar o modal

- `TaskRow` deixa de abrir `TaskEditModal`; passa a expandir inline.
- Conferir todos os consumidores de `TaskRow` (dashboard, `meeting-task-summary`, agrupamentos) — todos herdam o novo comportamento via contexto.
- `components/task-edit-modal.tsx` é **removido** quando não houver mais import. `TaskCreateModal`/captura continuam (criação não é o alvo deste pedido).

---

## Parte B — Quadros (centro de controle compartilhado)

### B.1 Modelo de dados — `db/0019_quadros.sql` (aditiva, idempotente, não-destrutiva)

```sql
BEGIN;

-- Quadro: pertence a um tenant (dono). Lista curada de tarefas, compartilhável.
CREATE TABLE IF NOT EXISTS quadros (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_quadros_user ON quadros(user_id) WHERE archived_at IS NULL;

-- Membership: quais tarefas estão no quadro (curadoria manual).
CREATE TABLE IF NOT EXISTS quadro_tarefas (
  quadro_id  UUID NOT NULL REFERENCES quadros(id) ON DELETE CASCADE,
  tarefa_id  UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  ordem      INT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quadro_id, tarefa_id)
);
CREATE INDEX IF NOT EXISTS idx_quadro_tarefas_tarefa ON quadro_tarefas(tarefa_id);

-- Convidados: 1 token (link) por pessoa. Token = credencial passwordless.
CREATE TABLE IF NOT EXISTS quadro_convidados (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quadro_id    UUID NOT NULL REFERENCES quadros(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_quadro_convidados_quadro ON quadro_convidados(quadro_id);

-- Atribuição de ações do convidado na auditoria existente.
ALTER TABLE tarefa_eventos
  ADD COLUMN IF NOT EXISTS quadro_convidado_id UUID NULL REFERENCES quadro_convidados(id) ON DELETE SET NULL;

-- RLS (espelha tarefa_frentes/tarefa_pessoas). Dono opera via withTenant(user_id).
ALTER TABLE quadros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadros_tenant ON quadros;
CREATE POLICY quadros_tenant ON quadros FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

ALTER TABLE quadro_tarefas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadro_tarefas_tenant ON quadro_tarefas;
CREATE POLICY quadro_tarefas_tenant ON quadro_tarefas FOR ALL
  USING (EXISTS (SELECT 1 FROM quadros q WHERE q.id = quadro_tarefas.quadro_id));

ALTER TABLE quadro_convidados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quadro_convidados_tenant ON quadro_convidados;
CREATE POLICY quadro_convidados_tenant ON quadro_convidados FOR ALL
  USING (EXISTS (SELECT 1 FROM quadros q WHERE q.id = quadro_convidados.quadro_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON quadros, quadro_tarefas, quadro_convidados
  TO app_tenant, app_writer;

-- Porta única do convidado: resolve o token SEM contexto de tenant.
-- SECURITY DEFINER → roda como dono da função (lê através do RLS) e devolve
-- só o mínimo pra bootstrapar o acesso, e só se o token é válido.
CREATE OR REPLACE FUNCTION resolver_quadro_token(p_token TEXT)
RETURNS TABLE (
  quadro_id UUID, user_id UUID, quadro_nome TEXT,
  convidado_id UUID, convidado_nome TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.user_id, q.nome, g.id, g.nome
  FROM quadro_convidados g
  JOIN quadros q ON q.id = g.quadro_id
  WHERE g.token = p_token
    AND g.revoked_at IS NULL
    AND q.archived_at IS NULL;
$$;
REVOKE ALL ON FUNCTION resolver_quadro_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_quadro_token(TEXT) TO app_tenant, app_writer;

COMMIT;
```

> RLS no Postgres self-hosted (container do swarm, ver memória *assistente-db-access*) — não é Supabase cloud. Migration roda com `psql -f`. Aditiva, sem DROP de tabela/coluna.

### B.2 Helpers de dados — `lib/quadros.ts`

`quadrosFor(userId)` (dono, via `withTenant`):
- `list()` — quadros do dono + contagem de tarefas/convidados.
- `criar(nome, descricao?)`, `renomear(id, …)`, `arquivar(id)`.
- `tarefas(id)` — tarefas do quadro (reusa o `TAREFA_SELECT` de `lib/queries.ts` com `JOIN quadro_tarefas`).
- `adicionarTarefas(id, tarefaIds[])`, `removerTarefa(id, tarefaId)`.
- `convidados(id)` — lista (nome, last_seen, revogado).
- `criarConvidado(id, nome)` — gera token `randomBytes(16).base64url`, insere, devolve o link.
- `revogarConvidado(id, convidadoId)`.
- `atividade(id)` — eventos recentes de `tarefa_eventos` com `quadro_convidado_id` (quem fez o quê).

`acessoConvidado(token)` (convidado): chama `resolver_quadro_token` via `query()`; devolve `{ quadroId, ownerId, quadroNome, convidadoId, convidadoNome }` ou `null`. Atualiza `last_seen_at`.

### B.3 UI + API do dono

**Nav:** novo item **"Quadros"** em `app/layout.tsx` → `/quadros`.

- **`/quadros`** (`app/quadros/page.tsx`) — lista de quadros, criar novo, contadores, link pra gerenciar.
- **`/quadros/[id]`** (`app/quadros/[id]/page.tsx`) — gerenciar um quadro:
  - Cabeçalho editável (nome/descrição) + arquivar.
  - **Tarefas do quadro** — lista (reusa `TaskRow`/`TasksDashboard` no `OwnerTaskProvider`), com remover-do-quadro e **adicionar tarefas** (picker com busca nas tarefas existentes).
  - **Links de convidado** — criar por nome → mostra/copia `https://…/q/<token>`; revogar; ver `last_seen`.
  - **Atividade** — feed dos eventos do convidado.
- **Adicionar ao quadro em massa:** nova ação no `components/bulk-action-bar.tsx` ("Adicionar a um quadro") pra curar do dashboard.

APIs do dono (todas `withAuth` → `withTenant`):
- `GET/POST /api/quadros`
- `PATCH/DELETE /api/quadros/[id]` (renomear/arquivar)
- `POST /api/quadros/[id]/tarefas` (add ids), `DELETE /api/quadros/[id]/tarefas/[tid]`
- `GET/POST /api/quadros/[id]/convidados`, `DELETE /api/quadros/[id]/convidados/[gid]`

### B.4 UI + API do convidado (público, auth por token)

**Página `/q/[token]`** (`app/q/[token]/page.tsx`) — em `PUBLIC_PREFIXES` do `proxy.ts`:
- Resolve via `acessoConvidado(token)`. Inválido/revogado/arquivado → página amigável "link não vale mais" (espelha o `/c/[code]` expirado). Rate-limit por IP (`lib/rate-limit.ts`).
- Válido → renderiza o quadro: nome, "você está como **{nome}**", as tarefas curadas como **cards editáveis inline** (Parte A via `GuestTaskProvider`), um **composer pra adicionar tarefa**, e o status visual (no prazo/hoje/vencida/feita) que o `TaskRow` já dá.
- Herda o layout raiz **sem a nav** (visitante sem sessão). Sem chrome do app.

APIs do convidado (em `PUBLIC_PREFIXES`; auth própria por token; rate-limit por `token:ip`):
- `GET /api/q/[token]/tarefas` — lista as tarefas do quadro.
- `POST /api/q/[token]/tarefas` — cria tarefa (insere no tenant do dono **com `user_id` do dono** + vincula em `quadro_tarefas`; evento `origem:'convidado'` + `quadro_convidado_id`).
- `PATCH /api/q/[token]/tarefas/[id]` — edita qualquer campo (edição total).
- `DELETE /api/q/[token]/tarefas/[id]` — apaga a tarefa.
- `GET /api/q/[token]/frentes` — áreas do dono (pro dropdown de área).

**Padrão obrigatório de todo handler do convidado** (`lib/quadro-guest.ts`, `withGuest(token, fn)`):
1. Rate-limit `token:ip`.
2. `acessoConvidado(token)` → 401 se inválido/revogado/arquivado.
3. `withTenant(ownerId, …)` — toda query roda no tenant do dono (RLS nunca alcança outro tenant).
4. **Toda operação em tarefa é restrita à membership do quadro**:
   `… WHERE id = $tid AND EXISTS (SELECT 1 FROM quadro_tarefas WHERE quadro_id = $qid AND tarefa_id = $tid)`.
   Criar tarefa vincula em `quadro_tarefas` na mesma transação.
5. Eventos gravam `quadro_convidado_id` (atribuição).

### B.5 Modelo de segurança (consolidado)

- **Isolamento de tenant:** convidado sempre opera dentro de `withTenant(ownerId)`; RLS garante que nunca toca outro tenant.
- **Confinamento ao quadro:** cada operação valida a membership — o convidado nunca vê/edita tarefas do dono fora do quadro, mesmo dentro do tenant.
- **Token:** 128 bits, na URL (padrão de link compartilhável), **revogável por pessoa**, expira ao arquivar o quadro. `last_seen_at` + auditoria por evento.
- **Rate-limit** em todas as rotas públicas (`/q/*` e `/api/q/*`).
- **`scope:"guest"` no front é só UX** — a autorização é 100% server-side.
- **Risco aceito:** convidado com "edição total" pode **apagar** tarefas do quadro (escolha explícita do Vitor). Mitigação: tokens por pessoa + revogação + atividade auditada. *(Opção futura, fora de escopo: trocar DELETE por "remover do quadro" ou soft-delete com desfazer.)*

---

## Rotas e arquivos

**Novos**
- `db/0019_quadros.sql`
- `lib/quadros.ts`, `lib/quadro-guest.ts` (`withGuest`), `lib/task-mutations.tsx`
- `components/task-edit-fields.tsx`, `components/quadro-manager.tsx`, `components/guest-board.tsx`, `components/add-to-quadro.tsx`
- `app/quadros/page.tsx`, `app/quadros/[id]/page.tsx`
- `app/q/[token]/page.tsx`
- `app/api/quadros/route.ts`, `app/api/quadros/[id]/route.ts`, `app/api/quadros/[id]/tarefas/route.ts`, `app/api/quadros/[id]/tarefas/[tid]/route.ts`, `app/api/quadros/[id]/convidados/route.ts`, `app/api/quadros/[id]/convidados/[gid]/route.ts`
- `app/api/q/[token]/tarefas/route.ts`, `app/api/q/[token]/tarefas/[id]/route.ts`, `app/api/q/[token]/frentes/route.ts`

**Modificados**
- `proxy.ts` — `/q/` e `/api/q/` em `PUBLIC_PREFIXES`.
- `app/layout.tsx` — item "Quadros" na nav.
- `components/task-row.tsx` — expand-in-place + `useTaskMutations` (substitui o modal).
- `components/capture-composer.tsx`, `components/task-create-modal.tsx`, `components/bulk-action-bar.tsx` — consumir contexto + "adicionar a quadro".
- `app/page.tsx`, `app/plano/page.tsx` — embrulhar no `OwnerTaskProvider`.

**Removido**
- `components/task-edit-modal.tsx` (após migrar todos os consumidores).

## Fases de implementação

1. **Edição inline (Parte A):** `TaskMutationContext` + `OwnerTaskProvider`, extrair `task-edit-fields.tsx`, expand-in-place no `TaskRow`, otimismo + `sonner`, quick-edit de prazo, aposentar o modal. *Entrega valor sozinha nas páginas do Vitor.*
2. **Schema + dono (Parte B):** migration `0019`, `lib/quadros.ts`, APIs do dono, `/quadros` + `/quadros/[id]`, nav, "adicionar a quadro".
3. **Convidado (Parte B):** `withGuest`, APIs `/api/q/[token]/*`, página `/q/[token]` reusando o card da Fase 1 via `GuestTaskProvider`, `proxy.ts`.
4. **Polish:** feed de atividade, `last_seen`, estados de link inválido/vazio, rate-limits afinados, auditoria.

## Fora de escopo

- Conteúdo de quadro por filtro salvo / por área / por pessoa (escolhido: lista curada manual).
- Convidado virar colaborador no mesmo tenant (RLS multi-user) — rejeitado.
- Comentários/chat no quadro, notificações, tempo real (WebSocket).
- Soft-delete/undo de tarefa; "remover do quadro" como alternativa ao apagar (anotado como opção futura).
- Drag-and-drop de ordenação no quadro do convidado.
- App iOS / Hermes / agente cientes de quadros.

## Decisões resolvidas (revisão 2026-06-29)

1. **Apagar do convidado:** **DELETE real (hard delete)** confirmado — convidado apaga de verdade, com atividade auditada por `quadro_convidado_id`.
2. **`sonner`** confirmado como lib de toast. Mais amplo: **investir em polish visual** — o quadro do convidado e os cards inline devem ser bonitos e claros (prioridade explícita).
3. **Nome:** interno `quadros`; rótulo de UI finalizado na build (decoupled, troca trivial).
4. **Multiplicidade:** vários quadros independentes; a mesma pessoa pode ser convidada em vários quadros (uma entrada `quadro_convidados` + um link por quadro). Já coberto pelo schema — `quadro_convidados` é por-quadro, sem unicidade global de pessoa.

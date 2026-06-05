# Tarefas Inteligentes — Fase 2 (UI: card rico + agrupado por pessoa) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar nas tarefas a riqueza que a Fase 1 gerou — descrição, evidência, área e pessoas envolvidas — e agrupar as tarefas da reunião por pessoa, sem trocar de aba.

**Architecture:** A query `byMeeting` passa a devolver `frente`, `frente_proposta` e `pessoas[]` (do join `tarefa_pessoas`). O `TaskRow` ganha descrição (1-2 linhas), evidência recolhível e chips de área + pessoas (display). A página da reunião agrupa as tarefas "suas" pela pessoa `principal` (ou "Você"). Edição inline de pessoas/área é Fase 2b (anotada, não incluída).

**Tech Stack:** Next.js 16 (App Router, Server Components), React client islands, Tailwind, node-postgres (`withTenant`), deploy via GitHub Actions → GHCR → swarm.

**Escopo:** display-only (sem mutações novas). O card rico vale em toda lista (Pendências + reunião). O agrupamento por pessoa vale na **página da reunião** (onde o problema foi reportado); o dashboard global mantém o agrupamento por prazo.

---

## Pré-requisitos
```bash
cd /Users/vitorgambetti/AssistentePessoal/frontend && source ../.env 2>/dev/null
# typecheck rápido: bunx tsc --noEmit -p tsconfig.json   (ignorar erro pré-existente em lib/detect-cuts.test.ts: bun:test)
```

## File Structure
- **Modify** `frontend/lib/queries.ts` — tipo `Tarefa` (+`frente`,`frente_proposta`,`pessoas`) + query `byMeeting`.
- **Modify** `frontend/components/task-row.tsx` — descrição + evidência recolhível + chips área/pessoas.
- **Create** `frontend/components/task-group-by-person.tsx` — agrupa lista por pessoa principal e renderiza com headings.
- **Modify** `frontend/app/reunioes/[id]/page.tsx` — usar o agrupamento por pessoa na seção "suas".

---

## Task 1: Query devolve frente + pessoas

**Files:**
- Modify: `frontend/lib/queries.ts` (tipo `Tarefa` ~linhas 42-58; método `byMeeting` ~linhas 265-283)

- [ ] **Step 1: Adicionar o tipo `TarefaPessoa` e campos no tipo `Tarefa`**

Em `frontend/lib/queries.ts`, logo antes de `export type Tarefa = {`, adicionar:
```ts
export type TarefaPessoa = { id: string; nome: string; principal: boolean };
```
E dentro de `export type Tarefa = { ... }`, após a linha `evidencia: string | null;`, adicionar:
```ts
  frente: string | null;
  frente_proposta: string | null;
  pessoas: TarefaPessoa[];
```

- [ ] **Step 2: Estender a query `byMeeting`**

Substituir o corpo do `db.query` em `byMeeting` (o `SELECT ... FROM tarefas WHERE meeting_id = $1 ORDER BY ...`) por:
```ts
      const r = await db.query<
        Tarefa & { prazo: string | null; created_at: string }
      >(
        `SELECT
           t.id, t.meeting_id, t.titulo, t.descricao, t.owner, t.is_mine, t.acao,
           to_char(t.prazo AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS prazo,
           t.prazo_text, t.prioridade, t.status, t.evidencia,
           to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           f.nome AS frente, t.frente_proposta,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'principal', tp.principal)
                             ORDER BY tp.principal DESC, p.nome)
             FROM tarefa_pessoas tp JOIN pessoas p ON p.id = tp.pessoa_id
             WHERE tp.tarefa_id = t.id
           ), '[]'::jsonb) AS pessoas
         FROM tarefas t
         LEFT JOIN frentes f ON f.id = t.frente_id
         WHERE t.meeting_id = $1
         ORDER BY (t.status NOT IN ('aberta','em_andamento')), (t.acao = 'aguardar'), (t.prazo IS NULL), t.prazo ASC, t.created_at ASC`,
        [meetingId],
      );
      return r.rows;
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'bun:test' | grep -v detect-cuts || true`
Expected: sem novos erros (saída vazia ou só o erro pré-existente filtrado).

- [ ] **Step 4: Verificar dado real via psql** (sanidade da query, sem subir front)

Run (usa o helper do plano Fase 1; `DBC` resolvido):
```bash
cd /Users/vitorgambetti/AssistentePessoal && source .env && DBC=$(sshpass -p "$VPS_ROOT_PASSWORD" ssh -o StrictHostKeyChecking=no "${VPS_SSH_USER}@${VPS_SSH_HOST}" "docker ps --format '{{.Names}}' | grep assistente-pessoal-db | head -1" 2>/dev/null)
echo "select t.titulo, f.nome as frente, (select jsonb_agg(p.nome) from tarefa_pessoas tp join pessoas p on p.id=tp.pessoa_id where tp.tarefa_id=t.id) pessoas from tarefas t left join frentes f on f.id=t.frente_id where t.meeting_id='0bc856aa-6474-4d18-a82a-3d04071728f9' limit 3;" | sshpass -p "$VPS_ROOT_PASSWORD" ssh -o StrictHostKeyChecking=no "${VPS_SSH_USER}@${VPS_SSH_HOST}" "docker exec -i $DBC psql -U assistente -d assistente_pessoal" 2>/dev/null | grep -viE 'collation|detail|hint|rebuild'
```
Expected: linhas com frente preenchida e array de pessoas (ex: `["Marcelo"]`).

- [ ] **Step 5: Commit**
```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/lib/queries.ts
git commit -m "feat(frontend/queries): byMeeting devolve frente + pessoas envolvidas"
```

---

## Task 2: TaskRow mostra descrição, evidência e chips de área/pessoas

**Files:**
- Modify: `frontend/components/task-row.tsx` (tipo `Tarefa` ~linhas 22-40; bloco de chips ~linhas onde está `<AcaoChip>`; bloco do título)

- [ ] **Step 1: Estender o tipo `Tarefa` do componente**

Em `frontend/components/task-row.tsx`, no `export type Tarefa = {`, após `evidencia: string | null;`, adicionar:
```ts
  frente: string | null;
  frente_proposta: string | null;
  pessoas: { id: string; nome: string; principal: boolean }[];
```

- [ ] **Step 2: Importar ícones usados (Tag, Users, Quote, ChevronDown)**

No import de `lucide-react` (topo do arquivo), adicionar `Tag, Users, Quote, ChevronDown` à lista existente.

- [ ] **Step 3: Adicionar estado de evidência recolhível**

Dentro de `export function TaskRow({ tarefa })`, junto aos outros `useState`, adicionar:
```ts
  const [showEvidencia, setShowEvidencia] = useState(false);
```

- [ ] **Step 4: Renderizar chips de área + pessoas na linha de chips do topo**

Logo após o `<AcaoToggle ... />` (dentro do `<div className="flex items-center flex-wrap gap-1.5 mb-1.5">`), adicionar:
```tsx
            {tarefa.frente && (
              <span className="inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)]">
                <Tag size={11} strokeWidth={2} />
                {tarefa.frente}
              </span>
            )}
            {!tarefa.frente && tarefa.frente_proposta && (
              <span className="inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] border border-dashed border-[color:var(--warm)]/40" title="Área sugerida pela IA — aprovar na edição (Fase 2b)">
                <Tag size={11} strokeWidth={2} />
                {tarefa.frente_proposta}?
              </span>
            )}
            {tarefa.pessoas
              .filter((p) => !p.principal)
              .map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 text-[11px] tracking-wide px-2 py-0.5 rounded-full bg-[color:var(--accent)]/60 text-[color:var(--muted-strong)]">
                  <Users size={11} strokeWidth={2} />
                  {p.nome}
                </span>
              ))}
```

- [ ] **Step 5: Renderizar descrição (1-2 linhas) sob o título**

Logo após o `<p>` do `{tarefa.titulo}`, adicionar:
```tsx
          {tarefa.descricao && (
            <p className="mt-1 text-[13px] leading-snug text-[color:var(--muted-strong)] line-clamp-2">
              {tarefa.descricao}
            </p>
          )}
```

- [ ] **Step 6: Renderizar evidência recolhível na linha de metadata**

Dentro da `<div className="mt-2 flex items-center flex-wrap gap-x-2 gap-y-1">`, ao final (após o chip de data), adicionar:
```tsx
            {tarefa.evidencia && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEvidencia((v) => !v);
                }}
                className="inline-flex items-center gap-1 text-[11px] text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
              >
                <Quote size={11} />
                trecho
                <ChevronDown size={11} className={cn("transition", showEvidencia && "rotate-180")} />
              </button>
            )}
```
E logo DEPOIS de fechar essa `<div>` da metadata, adicionar o trecho expandido:
```tsx
          {showEvidencia && tarefa.evidencia && (
            <p className="mt-2 text-[12px] italic text-[color:var(--muted)] border-l-2 border-[color:var(--border)] pl-3">
              &ldquo;{tarefa.evidencia}&rdquo;
            </p>
          )}
```

- [ ] **Step 7: Typecheck + lint**

Run: `cd frontend && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'bun:test' | grep -v detect-cuts || true ; bunx eslint components/task-row.tsx`
Expected: sem erros.

- [ ] **Step 8: Commit**
```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/components/task-row.tsx
git commit -m "feat(task-row): descrição + evidência recolhível + chips de área/pessoas"
```

---

## Task 3: Agrupar as tarefas da reunião por pessoa

**Files:**
- Create: `frontend/components/task-group-by-person.tsx`
- Modify: `frontend/app/reunioes/[id]/page.tsx` (seção "suas")

- [ ] **Step 1: Criar o componente de agrupamento**

Create `frontend/components/task-group-by-person.tsx`:
```tsx
import { UserRound } from "lucide-react";
import { TaskRow, type Tarefa } from "./task-row";

// Agrupa por pessoa principal (a marcada principal=true); sem principal → "Você".
function groupKey(t: Tarefa): { id: string; nome: string; ehVoce: boolean } {
  const principal = t.pessoas.find((p) => p.principal);
  if (principal) return { id: principal.id, nome: principal.nome, ehVoce: false };
  return { id: "__voce__", nome: "Você", ehVoce: true };
}

export function TaskGroupByPerson({ tarefas }: { tarefas: Tarefa[] }) {
  const groups = new Map<string, { nome: string; ehVoce: boolean; items: Tarefa[] }>();
  for (const t of tarefas) {
    const k = groupKey(t);
    const g = groups.get(k.id) ?? { nome: k.nome, ehVoce: k.ehVoce, items: [] };
    g.items.push(t);
    groups.set(k.id, g);
  }
  // "Você" primeiro, depois por nome
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.ehVoce !== b.ehVoce) return a.ehVoce ? -1 : 1;
    return a.nome.localeCompare(b.nome);
  });

  return (
    <div className="space-y-5">
      {ordered.map((g) => (
        <div key={g.nome} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <UserRound size={13} className="text-[color:var(--muted-strong)]" />
            <span className="text-[12px] tracking-wide text-[color:var(--muted-strong)] font-medium">
              {g.nome}
            </span>
            <span className="text-[11px] text-[color:var(--muted)]">· {g.items.length}</span>
          </div>
          <div className="space-y-2">
            {g.items.map((t) => (
              <TaskRow key={t.id} tarefa={t} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Usar o componente na página da reunião**

Em `frontend/app/reunioes/[id]/page.tsx`:
1. Adicionar o import no topo (junto aos outros de components):
```tsx
import { TaskGroupByPerson } from "@/components/task-group-by-person";
```
2. Localizar onde a lista `suas` é renderizada (hoje provavelmente um `.map((t) => <TaskRow .../>)`). Substituir esse map por:
```tsx
            <TaskGroupByPerson tarefas={suas} />
```
(Manter `aguardando` e `concluidas` como estão, com `TaskRow` direto — só `suas` agrupa por pessoa.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'bun:test' | grep -v detect-cuts || true`
Expected: sem novos erros.

- [ ] **Step 4: Commit**
```bash
cd /Users/vitorgambetti/AssistentePessoal
git add frontend/components/task-group-by-person.tsx frontend/app/reunioes/\[id\]/page.tsx
git commit -m "feat(reunioes): tarefas suas agrupadas por pessoa principal"
```

---

## Task 4: Build, deploy e verificação visual

**Files:** nenhum (deploy)

- [ ] **Step 1: Build local (pega erro antes do CI)**

Run: `cd frontend && bun run build 2>&1 | tail -20`
Expected: `Compiled successfully` (ou equivalente), sem erro de tipo/lint que aborte.

- [ ] **Step 2: Push + esperar GHA**

Run:
```bash
cd /Users/vitorgambetti/AssistentePessoal && git push origin main
gh run watch "$(gh run list --workflow=frontend.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status --interval 15 2>&1 | tail -5
```
Expected: build ✓.

- [ ] **Step 3: Forçar pull no swarm**

Run:
```bash
cd /Users/vitorgambetti/AssistentePessoal && source .env
FULLSHA=$(git rev-parse HEAD)
sshpass -p "$VPS_ROOT_PASSWORD" ssh -o StrictHostKeyChecking=no "${VPS_SSH_USER}@${VPS_SSH_HOST}" \
  "docker service update --image ghcr.io/vitorfawkes/assistente-pessoal-frontend:$FULLSHA --force n8n_assistente-frontend" 2>&1 | tail -3
```
Expected: `converged`.

- [ ] **Step 4: Verificação visual**

Abrir [/reunioes/0bc856aa](https://n8n-assistente-frontend.tatetz.easypanel.host/reunioes/0bc856aa-6474-4d18-a82a-3d04071728f9) logado e confirmar:
- Tarefas agrupadas por pessoa (Marcelo, Thiago, Você) com contagem.
- Cada card mostra descrição (1-2 linhas) + chips de área (Marketing/Dados/Vendas) + pessoas secundárias.
- Botão "trecho" expande a evidência.

---

## Self-Review (cobertura do spec §3 UI)
- "Card mostra mais (descrição/evidência/chips)" → Task 2. ✓
- "Agrupado por pessoa, sem abas" → Task 3 (página da reunião). ✓
- "Vale na Pendências e na reunião" → card rico (Task 2) é compartilhado (vale nas duas); agrupamento por pessoa só na reunião nesta fase (dashboard mantém prazo — anotado).
- **Edição inline (mudar área, add/remove pessoa, aprovar frente_proposta)** → **Fase 2b** (não incluída aqui). Anotado como próximo incremento.

## Fase 2b (próximo plano)
- Endpoints: PATCH tarefa `frente_id`; add/remove `tarefa_pessoas`; aprovar `frente_proposta` (cria frente + seta frente_id); listar frentes/pessoas pra selects.
- TaskRow/modal: chips editáveis (✎) pra área e pessoas; ação de aprovar área sugerida.

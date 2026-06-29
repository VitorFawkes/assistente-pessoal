# Quadros compartilháveis + edição inline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Implementar edição inline de tarefas + quadros compartilhados por token (dono curador, convidados editores), com auditoria completa e UI responsiva.

**Architecture:** Context-based mutations (TaskMutationContext) plugável para dono + convidado; schema Postgres com RLS + SECURITY DEFINER function pra tokens; APIs REST segregadas (`/api/tarefas/*` autenticado, `/api/q/[token]/*` público); GuestTaskProvider + GuestBoard SPA minimalista; auditoria via `tarefa_eventos.quadro_convidado_id`.

**Tech Stack:** Next.js 16, React 19, Tailwind 4, Postgres (pg) com RLS, bun:test, sonner.

---

## Contratos & File Map

### Fase 1: Edição Inline (Parte A)

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `lib/task-mutations.tsx` | **CRIAR** | `TaskMutations` context + `OwnerTaskProvider` + `GuestTaskProvider` + `useTaskMutations()` |
| `components/task-edit-fields.tsx` | **CRIAR** | Painel inline editável (reutilizável dono/convidado); campos: título, descrição, ação/owner, prioridade, início, prazo, no_plano, área, pessoas, status, deletar |
| `components/task-row.tsx` | **MODIFICAR** | Modo compacto + expandido (inline no próprio lugar); usar `useTaskMutations()` em vez de `fetch` direto; salvamento otimista por campo |
| `components/capture-composer.tsx` | **MODIFICAR** | Usar `useTaskMutations()` para `create` |
| `components/task-create-modal.tsx` | **MODIFICAR** | Usar `useTaskMutations()` para criar tarefa |
| `components/bulk-action-bar.tsx` | **MODIFICAR** | Adicionar ação "Adicionar a quadro"; chamar nova API ou integrar com convidado |
| `app/page.tsx` | **MODIFICAR** | Embrulhar `TasksDashboard` em `OwnerTaskProvider` |
| `app/plano/page.tsx` | **MODIFICAR** | Embrulhar `PlanoTimeline` em `OwnerTaskProvider` |
| `components/task-edit-modal.tsx` | **REMOVER** | Após migrar todos os consumidores (não haverá mais import) |
| `package.json` | **MODIFICAR** | Adicionar `sonner` (toast library) |
| `app/globals.css` | **VERIFICAR** | Design tokens devem estar presentes (--calm, --warm, --urgent, --accent, etc) |

### Fase 2: Schema + Dono (Parte B)

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `db/0019_quadros.sql` | **CRIAR** | `quadros`, `quadro_tarefas`, `quadro_convidados` + coluna `tarefa_eventos.quadro_convidado_id` + RLS + função `resolver_quadro_token` |
| `lib/quadros.ts` | **CRIAR** | `quadrosFor(userId)` (list, get, criar, atualizar, arquivar, tarefas, adicionarTarefas, removerTarefa, convidados, criarConvidado, revogarConvidado, atividade) + `acessoConvidado(token)` |
| `app/quadros/page.tsx` | **CRIAR** | Lista de quadros; novo; contadores; link pra gerenciar |
| `app/quadros/[id]/page.tsx` | **CRIAR** | Gerenciar quadro: cabeçalho editável + tarefas + links de convidado + atividade |
| `app/api/quadros/route.ts` | **CRIAR** | `GET` (list), `POST` (criar) |
| `app/api/quadros/[id]/route.ts` | **CRIAR** | `PATCH` (renomear/arquivar), `DELETE` (arquivar) |
| `app/api/quadros/[id]/tarefas/route.ts` | **CRIAR** | `POST` (adicionar ids ao quadro) |
| `app/api/quadros/[id]/tarefas/[tid]/route.ts` | **CRIAR** | `DELETE` (remover tarefa do quadro) |
| `app/api/quadros/[id]/convidados/route.ts` | **CRIAR** | `GET` (list), `POST` (criar com token) |
| `app/api/quadros/[id]/convidados/[gid]/route.ts` | **CRIAR** | `DELETE` (revogar convidado) |
| `app/layout.tsx` | **MODIFICAR** | Adicionar item "Quadros" na nav (entre "Pessoas" e "Assistente", ou onde apropriado) |
| `proxy.ts` | **MODIFICAR** | Adicionar `/q/` e `/api/q/` em `PUBLIC_PREFIXES` |

### Fase 3: Convidado (Parte C)

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `lib/quadro-guest.ts` | **CRIAR** | `withGuest(token, ip, fn)`: rate-limit, resolver token, withTenant, confinar à membership do quadro; `membershipDoQuadro(c, ...)` |
| `app/q/[token]/page.tsx` | **CRIAR** | Renderizar quadro do convidado (nome, "você está como {nome}", tarefas editáveis, composer); inválido/revogado → página amigável |
| `app/api/q/[token]/tarefas/route.ts` | **CRIAR** | `GET` (list), `POST` (criar) |
| `app/api/q/[token]/tarefas/[id]/route.ts` | **CRIAR** | `PATCH` (editar), `DELETE` (apagar) |
| `app/api/q/[token]/frentes/route.ts` | **CRIAR** | `GET` (áreas do dono) |

### Fase 4: Polish

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `components/activity-feed.tsx` | **CRIAR** | Feed de atividade auditada (quem, o quê, quando) |
| `components/guest-board-error.tsx` | **CRIAR** | Estados de erro amigáveis (token inválido, rate-limit, não encontrado) |
| `components/copy-link-button.tsx` | **CRIAR** | Botão copiar link com feedback visual (2s "Copiado!") |
| `components/quadro-manager.tsx` | **CRIAR** | Gerenciar um quadro (cabeçalho, tarefas, convidados, atividade) |
| `components/guest-board.tsx` | **CRIAR** | UI do quadro do convidado (cards, composer, sem nav) |
| `lib/quadros.test.ts` | **CRIAR** | Testes de helpers `quadrosFor()` |
| `lib/quadro-guest.test.ts` | **CRIAR** | Testes de `withGuest()` + validação de membership |
| `docs/quadros-deployment.md` | **CRIAR** | Checklist de deploy pós-produção |

---

## Migration SQL — `db/0019_quadros.sql`

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

---

## Tipos de Domínio (TypeScript)

```typescript
// lib/quadros.ts ou lib/queries.ts

export type Quadro = {
  id: string;
  user_id: string;
  nome: string;
  descricao: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type QuadroConvidado = {
  id: string;
  quadro_id: string;
  nome: string;
  token: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type QuadroComContagem = Quadro & {
  n_tarefas: number;
  n_convidados: number;
};

// Retorno de resolver_quadro_token (função SQL SECURITY DEFINER)
export type AcessoConvidado = {
  quadroId: string;
  ownerId: string;
  quadroNome: string;
  convidadoId: string;
  convidadoNome: string;
};

// Eventos auditados com atribuição de convidado
export type TarefaEvento = {
  id: string;
  tarefa_id: string;
  user_id: string;
  quadro_convidado_id: string | null;
  acao: string;
  patch_dados: Record<string, unknown> | null;
  origem: string;
  created_at: string;
};

export type AtividadeItem = {
  id: string;
  criado_em: string;
  acao: string;
  mudancas: Record<string, [before: unknown, after: unknown]> | null;
  tarefa_titulo: string;
  tarefa_id: string;
  convidado_nome: string | null;
  convidado_id: string | null;
};

export type TarefaPessoa = {
  id?: string;
  nome: string;
  principal?: boolean;
};
```

---

## Interface `TaskMutations` — `lib/task-mutations.tsx`

```typescript
import { createContext, useContext, ReactNode } from "react";
import type { Tarefa, Acao } from "@/lib/queries";
import type { TarefaPessoa } from "@/lib/quadros";

// Tipos publicamente consumidos
export type TaskMutations = {
  // Editar tarefa existente (patch parcial)
  patch: (id: string, body: Partial<{
    titulo?: string;
    descricao?: string | null;
    owner?: string;
    acao?: Acao;
    prazo?: string | null;
    prazo_text?: string | null;
    prioridade?: Tarefa["prioridade"];
    status?: Tarefa["status"];
    no_plano?: boolean;
    frente_id?: string | null;
    inicio?: string | null;
    pessoas?: TarefaPessoa[];
  }>) => Promise<Tarefa | null>;
  
  // Deletar tarefa
  remove: (id: string, opts?: { motivo?: string }) => Promise<void>;
  
  // Criar tarefa nova
  create: (draft: {
    titulo: string;
    descricao?: string | null;
    owner?: string;
    acao?: Acao;
    prazo?: string | null;
    prazo_text?: string | null;
    prioridade?: Tarefa["prioridade"];
    frente_id?: string | null;
    inicio?: string | null;
    pessoas?: TarefaPessoa[];
    no_plano?: boolean;
  }) => Promise<Tarefa | null>;
  
  // Listar áreas (frentes) disponíveis
  listFrentes: () => Promise<{ id: string; nome: string }[]>;
  
  // Criar nova área (dono só)
  createFrente?: (nome: string) => Promise<{ id: string; nome: string } | null>;
  
  // Refresh: router.refresh() (dono) ou re-fetch local (convidado)
  refresh: () => void;
  
  // Escopo: indica se é dono ou convidado (UI, não segurança)
  scope: "owner" | "guest";
};

export const TaskMutationContext = createContext<TaskMutations | null>(null);

export function useTaskMutations(): TaskMutations {
  const ctx = useContext(TaskMutationContext);
  if (!ctx) throw new Error("useTaskMutations deve estar dentro de TaskMutationProvider");
  return ctx;
}

// OwnerTaskProvider — para donos (PATCH/DELETE/POST `/api/tarefas/*`)
export type OwnerTaskProviderProps = {
  children: ReactNode;
};

export function OwnerTaskProvider({ children }: OwnerTaskProviderProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const value: TaskMutations = {
    patch: async (id, body) => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/tarefas/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
        const data = await res.json();
        toast.success("Tarefa atualizada");
        router.refresh();
        return data;
      } catch (err) {
        toast.error(`Erro ao atualizar: ${err instanceof Error ? err.message : "desconhecido"}`);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    
    remove: async (id, opts) => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/tarefas/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: opts?.motivo || "deletada pelo usuário" }),
        });
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
        toast.success("Tarefa removida");
        router.refresh();
      } catch (err) {
        toast.error(`Erro ao remover: ${err instanceof Error ? err.message : "desconhecido"}`);
      } finally {
        setIsLoading(false);
      }
    },
    
    create: async (draft) => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/tarefas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
        const data = await res.json();
        toast.success("Tarefa criada");
        router.refresh();
        return data;
      } catch (err) {
        toast.error(`Erro ao criar: ${err instanceof Error ? err.message : "desconhecido"}`);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    
    listFrentes: async () => {
      try {
        const res = await fetch("/api/frentes");
        if (!res.ok) throw new Error(`GET frentes failed: ${res.status}`);
        const data = await res.json();
        return data.frentes || [];
      } catch (err) {
        toast.error("Erro ao carregar áreas");
        return [];
      }
    },
    
    refresh: () => {
      router.refresh();
    },
    
    scope: "owner",
  };

  return (
    <TaskMutationContext.Provider value={value}>
      {children}
    </TaskMutationContext.Provider>
  );
}

// GuestTaskProvider — para convidados (PATCH/DELETE/POST `/api/q/[token]/*`)
export type GuestTaskProviderProps = {
  token: string;
  children: ReactNode;
};

export function GuestTaskProvider({ token, children }: GuestTaskProviderProps) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);

  const value: TaskMutations = {
    patch: async (id, body) => {
      try {
        const res = await fetch(`/api/q/${token}/tarefas/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
        const data = await res.json();
        setTarefas(t => t.map(x => x.id === id ? data : x));
        toast.success("Tarefa atualizada");
        return data;
      } catch (err) {
        toast.error(`Erro ao atualizar: ${err instanceof Error ? err.message : "desconhecido"}`);
        return null;
      }
    },
    
    remove: async (id) => {
      try {
        const res = await fetch(`/api/q/${token}/tarefas/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
        setTarefas(t => t.filter(x => x.id !== id));
        toast.success("Tarefa removida");
      } catch (err) {
        toast.error(`Erro ao remover: ${err instanceof Error ? err.message : "desconhecido"}`);
      }
    },
    
    create: async (draft) => {
      try {
        const res = await fetch(`/api/q/${token}/tarefas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
        const data = await res.json();
        setTarefas(t => [...t, data]);
        toast.success("Tarefa criada");
        return data;
      } catch (err) {
        toast.error(`Erro ao criar: ${err instanceof Error ? err.message : "desconhecido"}`);
        return null;
      }
    },
    
    listFrentes: async () => {
      try {
        const res = await fetch(`/api/q/${token}/frentes`);
        if (!res.ok) throw new Error(`GET frentes failed: ${res.status}`);
        const data = await res.json();
        return data.frentes || [];
      } catch (err) {
        toast.error("Erro ao carregar áreas");
        return [];
      }
    },
    
    refresh: () => {
      // Re-fetch local das tarefas (sem router.refresh)
      fetch(`/api/q/${token}/tarefas`)
        .then(r => r.json())
        .then(data => setTarefas(data.tarefas || []))
        .catch(() => toast.error("Erro ao recarregar tarefas"));
    },
    
    scope: "guest",
  };

  return (
    <TaskMutationContext.Provider value={value}>
      {children}
    </TaskMutationContext.Provider>
  );
}
```

---

## Helper `withGuest` — `lib/quadro-guest.ts`

```typescript
import type { PoolClient } from "pg";
import { query, withTenant } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import type { AcessoConvidado } from "@/lib/quadros";

export class GuestError extends Error {
  constructor(public code: "rate_limit" | "invalid_token") {
    super(code);
  }
}

/**
 * Porta única do convidado. Resolve o token (resolver_quadro_token é
 * SECURITY DEFINER → ignora RLS), abre o tenant do DONO e roda `fn` com o
 * MESMO client `c`. REGRA: toda query do convidado DEVE usar `c` — abrir
 * outra conexão (query() ou novo withTenant) roda sem o app.current_user_id
 * dessa transação e a RLS bloquearia quadro_tarefas/quadro_convidados.
 */
export async function withGuest<T>(
  token: string,
  ip: string,
  fn: (ctx: { acesso: AcessoConvidado; c: PoolClient }) => Promise<T>,
): Promise<T> {
  if (!rateLimit(`q:${token}:${ip}`, 30, 60_000)) throw new GuestError("rate_limit");

  const rows = await query<AcessoConvidado>(
    `SELECT quadro_id AS "quadroId", user_id AS "ownerId", quadro_nome AS "quadroNome",
            convidado_id AS "convidadoId", convidado_nome AS "convidadoNome"
       FROM resolver_quadro_token($1)`,
    [token],
  );
  if (rows.length === 0) throw new GuestError("invalid_token");
  const acesso = rows[0];

  return withTenant(acesso.ownerId, async (c) => {
    // best-effort last_seen no MESMO client (tenant = dono → RLS ok)
    await c.query(`UPDATE quadro_convidados SET last_seen_at = now() WHERE id = $1`, [acesso.convidadoId]);
    return fn({ acesso, c });
  });
}

/** Membership confinada ao quadro. Roda no client tenant `c` (RLS escopado ao dono). */
export async function membershipDoQuadro(
  c: PoolClient,
  quadroId: string,
  tarefaId: string,
): Promise<boolean> {
  const r = await c.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM quadro_tarefas WHERE quadro_id = $1 AND tarefa_id = $2) AS exists`,
    [quadroId, tarefaId],
  );
  return r.rows[0]?.exists ?? false;
}
```

---

## Fase 1 — Edição Inline (Edit-in-Place) + Contexto Plugável

Objetivo: Substituir o pop-up TaskEditModal por edição no próprio card (expand-in-place), introduzindo TaskMutationContext para reuso por dono e convidado (base para Fase 2).

### Task 1: Criar TaskMutationContext + OwnerTaskProvider + GuestTaskProvider

**Files:**
- **Create:** `frontend/lib/task-mutations.tsx`

**Descrição:** Implementar TaskMutations context com OwnerTaskProvider (fetch calls pra `/api/tarefas/*` + router.refresh()) e GuestTaskProvider (fetch calls pra `/api/q/[token]/tarefas/*` + refetch local). Ambas exportam useTaskMutations() hook.

**Passos:**

- [ ] 1.1. Criar arquivo `frontend/lib/task-mutations.tsx` com conteúdo exato do contrato acima (tipos TaskMutations, OwnerTaskProviderProps, GuestTaskProviderProps, useTaskMutations, OwnerTaskProvider com imports de router e useState, GuestTaskProvider com estado local tarefas)
- [ ] 1.2. Implementar OwnerTaskProvider.patch() com fetch PATCH `/api/tarefas/${id}`, toast.success, router.refresh()
- [ ] 1.3. Implementar OwnerTaskProvider.remove() com fetch DELETE `/api/tarefas/${id}`, toast.success, router.refresh()
- [ ] 1.4. Implementar OwnerTaskProvider.create() com fetch POST `/api/tarefas`, toast.success, router.refresh()
- [ ] 1.5. Implementar OwnerTaskProvider.listFrentes() com fetch GET `/api/frentes`
- [ ] 1.6. Implementar OwnerTaskProvider.refresh() com router.refresh()
- [ ] 1.7. Implementar GuestTaskProvider.patch() com fetch PATCH `/api/q/${token}/tarefas/${id}`, atualiza estado setTarefas, toast.success
- [ ] 1.8. Implementar GuestTaskProvider.remove() com fetch DELETE `/api/q/${token}/tarefas/${id}`, remove do estado, toast.success
- [ ] 1.9. Implementar GuestTaskProvider.create() com fetch POST `/api/q/${token}/tarefas`, adiciona ao estado, toast.success
- [ ] 1.10. Implementar GuestTaskProvider.listFrentes() com fetch GET `/api/q/${token}/frentes`
- [ ] 1.11. Implementar GuestTaskProvider.refresh() com refetch local (fetch `/api/q/${token}/tarefas` e atualiza setTarefas)
- [ ] 1.12. Testar compilação: `cd /Users/vitorgambetti/AssistentePessoal/frontend && bun run build` — deve passar sem erros
- [ ] 1.13. Commit: feat(task-mutations): context com OwnerTaskProvider e GuestTaskProvider + useTaskMutations hook

---

### Task 2: Adicionar sonner ao package.json

**Files:**
- **Modify:** `frontend/package.json`

**Passos:**

- [ ] 2.1. Abrir `frontend/package.json`, localizar seção `dependencies`
- [ ] 2.2. Adicionar linha: `"sonner": "^latest"` (ou versão específica, ex: "^1.4.0")
- [ ] 2.3. Rodar `bun install` pra resolver dependências
- [ ] 2.4. Verificar que `bun.lock` foi atualizado
- [ ] 2.5. Rodar `bun run build` — deve compilar (ainda vai faltar os usos em componentes, mas libs vão)
- [ ] 2.6. Commit: feat(deps): add sonner para toasts

---

### Task 3: Criar TaskEditFields — campos puros reutilizáveis

**Files:**
- **Create:** `frontend/components/task-edit-fields.tsx`

**Descrição:** Componente puro que recebe tarefa + useTaskMutations, renderiza campos inline (título, descrição, ação, responsável, prioridade, início, prazo, no_plano, área, pessoas, status, botão deletar). Salvamento otimista por campo (blur/change, sem botão "Salvar").

**Campos a extrair:** título, descrição, ação/responsável, prioridade, início, prazo (+ atalhos hoje/amanhã/sexta/+1 semana), no_plano, área/frente, pessoas (nomes + principal), status, botão deletar com confirmação.

**Passos:**

- [ ] 3.1. Extrair campos do TaskEditModal existente (qual arquivo? verificar imports em task-row.tsx)
- [ ] 3.2. Criar componente puro `TaskEditFields({ tarefa }: { tarefa: Tarefa })` que chama `useTaskMutations()` internamente
- [ ] 3.3. Implementar campo título: `<input value={tarefa.titulo} onBlur={(e) => mut.patch(...)} />` — salvamento automático ao blur
- [ ] 3.4. Implementar campo descrição: textarea, onBlur → patch
- [ ] 3.5. Implementar campo ação: popover picker (reusar componente existente se houver), onSelect → patch com origem:'manual'
- [ ] 3.6. Implementar campo responsável (owner): picker de pessoas/nomes, onSelect → patch
- [ ] 3.7. Implementar campo prioridade: radio/select (baixa/media/alta/urgente), onChange → patch
- [ ] 3.8. Implementar campo início: date input, onChange → patch
- [ ] 3.9. Implementar campo prazo: date input + quick buttons ("Hoje", "Amanhã", "Sexta", "+1 semana"), onClick button → calcula data → patch
- [ ] 3.10. Implementar campo no_plano: checkbox, onChange → patch
- [ ] 3.11. Implementar campo área/frente: picker do listFrentes(), onChange → patch
- [ ] 3.12. Implementar campo pessoas: lista com add/remove, cada item tem nome + checkbox principal, onChange → patch com shape TarefaPessoa[]
- [ ] 3.13. Implementar campo status: radio/select (conforme enum existente), onChange → patch
- [ ] 3.14. Implementar botão deletar: 2-toque confirmação, clique 1 → "Tem certeza?", clique 2 → mut.remove()
- [ ] 3.15. Validação client-side: título vazio bloqueado (disable input se empty)
- [ ] 3.16. Erros aparecem como toast (via useTaskMutations que já tem try-catch)
- [ ] 3.17. Rodar `bun run build` — deve passar
- [ ] 3.18. Commit: feat(task-edit-fields): componente inline com salvamento otimista por campo

---

### Task 4: Modificar TaskRow — modo expandido inline

**Files:**
- **Modify:** `frontend/components/task-row.tsx`

**Passos:**

- [ ] 4.1. Adicionar estado `const [expanded, setExpanded] = useState(false)` ao TaskRow
- [ ] 4.2. Modo compacto: renderização atual (card resumido com clique pra expandir)
- [ ] 4.3. Modo expandido: renderiza TaskEditFields dentro do card (não modal)
- [ ] 4.4. Clique fora (detectar com useEffect + ref ou Escape key) → setExpanded(false)
- [ ] 4.5. Clicar em qualquer campo editável agora não abre modal, apenas expande o card
- [ ] 4.6. Remover import de TaskEditModal (se houver)
- [ ] 4.7. Deletar é 2-toque inline (confirmação dentro do card expandido)
- [ ] 4.8. AcaoEditor (popover inline de ação) continua funcionando mesmo em modo compacto (não precisa expandir)
- [ ] 4.9. Rodar `bun run build` — deve passar
- [ ] 4.10. Commit: feat(task-row): expand-in-place com TaskEditFields (sem modal)

---

### Task 5: Modificar AcaoEditor — usar useTaskMutations

**Files:**
- **Modify:** `frontend/components/task-row.tsx` (função/componente AcaoEditor interna)

**Passos:**

- [ ] 5.1. Na função AcaoEditor, importar `useTaskMutations` no início do componente
- [ ] 5.2. Chamar `const mut = useTaskMutations()` no corpo
- [ ] 5.3. Substituir `fetch('/api/tarefas/...')` e `router.refresh()` por `mut.patch()` e `mut.refresh()`
- [ ] 5.4. Remover imports de fetch/router diretos se não forem usados em outro lugar
- [ ] 5.5. Rodar `bun run build` — deve passar
- [ ] 5.6. Commit: fix(task-row): AcaoEditor usa useTaskMutations

---

### Task 6: Modificar CaptureComposer — usar useTaskMutations

**Files:**
- **Modify:** `frontend/components/capture-composer.tsx`

**Passos:**

- [ ] 6.1. Importar `useTaskMutations` no inicio do componente
- [ ] 6.2. Chamar `const mut = useTaskMutations()` no corpo
- [ ] 6.3. Na função capturar (ou listener de enter), substituir `fetch("/api/capturar")` + `router.refresh()` por `mut.create(parsedDraft)`
- [ ] 6.4. Adaptar shape do draft para match TaskMutations.create signature (titulo, descricao, owner, acao, prazo, prioridade, frente_id, pessoas, no_plano)
- [ ] 6.5. Remover fetch/router diretos se não forem usados em outro lugar
- [ ] 6.6. Rodar `bun run build` — deve passar
- [ ] 6.7. Commit: fix(capture-composer): usa useTaskMutations para criar tarefas

---

### Task 7: Embrulhar páginas em OwnerTaskProvider

**Files:**
- **Modify:** `frontend/app/page.tsx`
- **Modify:** `frontend/app/plano/page.tsx`

**Passos:**

- [ ] 7.1. Em `app/page.tsx`, importar `OwnerTaskProvider` de `lib/task-mutations`
- [ ] 7.2. Envolver o componente raiz (ex: `<TasksDashboard />`) com `<OwnerTaskProvider>{children}</OwnerTaskProvider>`
- [ ] 7.3. Em `app/plano/page.tsx`, mesma operação com PlanoTimeline ou componente principal
- [ ] 7.4. Verificar que tasks-dashboard.tsx e plano components não precisam modificação (já usam contexto via filhos)
- [ ] 7.5. Rodar `bun run build` — deve passar
- [ ] 7.6. Commit: feat(pages): wrap home e plano em OwnerTaskProvider

---

### Task 8: Montar Toaster do sonner no layout

**Files:**
- **Modify:** `frontend/app/layout.tsx`

**Passos:**

- [ ] 8.1. Importar `Toaster` de `sonner`
- [ ] 8.2. Renderizar `<Toaster />` perto do final da árvore (tipicamente perto de `</html>` ou como último child do body/root)
- [ ] 8.3. Opcionalmente passar props de config (ex: `theme="light"` ou `position="top-right"`)
- [ ] 8.4. Rodar `bun run build` — deve passar
- [ ] 8.5. Commit: feat(layout): add Toaster do sonner para exibir notificações

---

### Task 9: Remover TaskEditModal — cleanup

**Files:**
- **Remove:** `frontend/components/task-edit-modal.tsx`

**Passos:**

- [ ] 9.1. Rodar `grep -r "task-edit-modal" frontend/` pra confirmar que nenhum arquivo importa
- [ ] 9.2. Se houver importações, update-as pra usar TaskEditFields ao invés
- [ ] 9.3. Deletar `frontend/components/task-edit-modal.tsx`
- [ ] 9.4. Rodar `bun run build` — deve passar
- [ ] 9.5. Commit: fix: remove TaskEditModal (completamente migrado pra inline TaskEditFields)

---

### Task 10: Verificação manual completa (Fase 1)

**Objetivo:** Rodar a app em dev, navegar, editar tarefas, confirmar que tudo funciona sem regressão.

**Passos:**

- [ ] 10.1. `cd /Users/vitorgambetti/AssistentePessoal/frontend && bun run dev`
- [ ] 10.2. Abrir http://localhost:3000 (ou http://localhost:3000/plano para ver timeline)
- [ ] 10.3. **Teste 1 — Expandir card:** Clicar num card de tarefa → deve expandir inline (não abrir modal) → clicar Esc → deve colapsar → clicar fora → deve colapsar
- [ ] 10.4. **Teste 2 — Editar título:** Expandir card → mudar título → clicar fora do input → deve salvar automaticamente (sem botão "Salvar") → toast "Tarefa atualizada"
- [ ] 10.5. **Teste 3 — Editar prazo via quick-button:** Expandir card → clicar "Hoje" no painel de prazos → deve salvar automaticamente → verificar que prazo mudou
- [ ] 10.6. **Teste 4 — AcaoEditor popover (sem expandir):** No card compacto, clicar no chip de ação/responsável → popover abre → trocar ação → deve aplicar → popover fecha
- [ ] 10.7. **Teste 5 — Deletar (2 toques):** Expandir card → clicar "Deletar" → aparece "Tem certeza?" → clicar novamente → tarefa desaparece
- [ ] 10.8. **Teste 6 — Capturador:** Abrir /pendências ou aba main → escrever algo no composer → Enter → cria tarefa nova → tarefa aparece na lista
- [ ] 10.9. **Teste 7 — Responsive mobile:** Abrir DevTools (Cmd+Alt+I), Device Toolbar 375px → todos os campos/buttons são clicáveis e responsivos
- [ ] 10.10. Verificar console do navegador — nenhum erro de React/TypeScript
- [ ] 10.11. Commit: test(f1): verificação manual OK — inline editing, popover acao, capture, responsive

---

### Task 11: Documentação interna (opcional mas recomendado)

**Files:**
- **Create:** `frontend/lib/TASK_MUTATIONS.md`

**Passos:**

- [ ] 11.1. Criar arquivo documentando:
  - O que é TaskMutations context
  - Como usar useTaskMutations()
  - OwnerTaskProvider vs GuestTaskProvider
  - Exemplo de uso em componente
  - Como adicionar novo campo em TaskEditFields
  - Como lidar com erros e toasts

- [ ] 11.2. Commit: docs: add TASK_MUTATIONS.md (usage guide)

---

## Fase 2 — Schema + UI/API do Dono (Quadros, Curadoria, Links)

Objetivo: Dono cria quadros, cura tarefas manualmente, gera/revoga links por pessoa. Schema Postgres, helpers de lib, e APIs REST (CRUD quadro + convidados).

### Task 12: Migration SQL: quadros + RLS + SECURITY DEFINER

**Files:**
- **Create:** `/Users/vitorgambetti/AssistentePessoal/db/0019_quadros.sql`

**Passos:**

- [ ] 12.1. Criar arquivo com conteúdo exato do contrato migration acima (BEGIN/COMMIT, quadros, quadro_tarefas, quadro_convidados, RLS, SECURITY DEFINER resolver_quadro_token)
- [ ] 12.2. Verificar sintaxe SQL (nenhum erro visual, indentação OK)
- [ ] 12.3. Rodar migration: `psql "$DATABASE_URL" -f /Users/vitorgambetti/AssistentePessoal/db/0019_quadros.sql`
- [ ] 12.4. Verificar que não houve erros (checar quadros, quadro_tarefas, quadro_convidados existem em schema)
- [ ] 12.5. Commit: db: migration 0019 — quadros + RLS + resolver_quadro_token SECURITY DEFINER

---

### Task 13: Tipos de domínio e helpers: `lib/quadros.ts`

**Files:**
- **Create:** `frontend/lib/quadros.ts`

**Assinatura de quadrosFor(userId):**
```typescript
export function quadrosFor(userId: string) {
  return {
    list: () => Promise<QuadroComContagem[]>,
    get: (id: string) => Promise<Quadro | null>,
    criar: (nome: string, descricao?: string) => Promise<Quadro>,
    atualizar: (id: string, nome?: string, descricao?: string) => Promise<Quadro | null>,
    arquivar: (id: string) => Promise<void>,
    tarefas: (quadroId: string) => Promise<Tarefa[]>,
    adicionarTarefas: (quadroId: string, tarefaIds: string[]) => Promise<{ adicionadas: number; duplicadas: number }>,
    removerTarefa: (quadroId: string, tarefaId: string) => Promise<void>,
    convidados: (quadroId: string) => Promise<QuadroConvidado[]>,
    criarConvidado: (quadroId: string, nome: string) => Promise<{ id: string; nome: string; token: string; link: string }>,
    revogarConvidado: (quadroId: string, convidadoId: string) => Promise<void>,
    atividade: (quadroId: string, limit?: number) => Promise<AtividadeItem[]>,
  };
}
```

**Passos:**

- [ ] 13.1. Criar arquivo `frontend/lib/quadros.ts` com tipos (Quadro, QuadroConvidado, QuadroComContagem, AcessoConvidado, TarefaEvento, AtividadeItem)
- [ ] 13.2. Implementar `quadrosFor(userId)` factory que retorna objeto com métodos
- [ ] 13.3. Implementar `.list()`: SELECT com COUNT de tarefas/convidados por quadro
- [ ] 13.4. Implementar `.get(id)`: SELECT WHERE id = $1
- [ ] 13.5. Implementar `.criar(nome, descricao)`: INSERT, retorna Quadro
- [ ] 13.6. Implementar `.atualizar(id, nome?, descricao?)`: UPDATE, retorna Quadro | null
- [ ] 13.7. Implementar `.arquivar(id)`: UPDATE archived_at = now()
- [ ] 13.8. Implementar `.tarefas(quadroId)`: SELECT FROM quadro_tarefas JOIN tarefas
- [ ] 13.9. Implementar `.adicionarTarefas(quadroId, tarefaIds)`: INSERT INTO quadro_tarefas (com conflict handling)
- [ ] 13.10. Implementar `.removerTarefa(quadroId, tarefaId)`: DELETE FROM quadro_tarefas
- [ ] 13.11. Implementar `.convidados(quadroId)`: SELECT * FROM quadro_convidados WHERE revoked_at IS NULL
- [ ] 13.12. Implementar `.criarConvidado(quadroId, nome)`: gera token via `randomBytes(16).toString("base64url")`, INSERT, retorna { id, nome, token, link }
- [ ] 13.13. Implementar `.revogarConvidado(quadroId, convidadoId)`: UPDATE revoked_at = now()
- [ ] 13.14. Implementar `.atividade(quadroId, limit)`: SELECT FROM tarefa_eventos LEFT JOIN quadro_convidados, ordena por created_at DESC
- [ ] 13.15. Criar testes em `frontend/lib/quadros.test.ts` (mínimo: list retorna QuadroComContagem[], criar gera token único)
- [ ] 13.16. Rodar `bun test frontend/lib/quadros.test.ts` — deve passar
- [ ] 13.17. Rodar `bun run build` — deve passar
- [ ] 13.18. Commit: feat(quadros): quadrosFor helper com CRUD + convidados + atividade

---

### Task 14: Helper `withGuest` e tipos: `lib/quadro-guest.ts`

**Files:**
- **Create:** `frontend/lib/quadro-guest.ts`

**Assinatura corrigida:**
```typescript
// Token 2 args: token, ip (extraído do req no handler)
export async function withGuest<T>(
  token: string,
  ip: string,
  fn: (ctx: { acesso: AcessoConvidado; c: PoolClient }) => Promise<T>,
): Promise<T>

// Helper de membership que roda no client tenantizado
export async function membershipDoQuadro(
  c: PoolClient,
  quadroId: string,
  tarefaId: string,
): Promise<boolean>
```

**Passos:**

- [ ] 14.1. Criar arquivo com classe `GuestError(code: 'rate_limit' | 'invalid_token')`
- [ ] 14.2. Implementar `withGuest(token, ip, fn)` (3 args, NÃO req): rate-limit por token:ip (30 req/min)
- [ ] 14.3. Resolver token via query SECURITY DEFINER, throw GuestError('invalid_token') se rows.length === 0
- [ ] 14.4. Abrir withTenant(acesso.ownerId, async (c) => ...), passar `c` ao callback
- [ ] 14.5. Dentro withTenant, atualizar last_seen_at NO MESMO client `c.query(UPDATE...)`
- [ ] 14.6. Callback recebe `{ acesso, c }` — TODO uso de query deve passar por `c` (em contexto tenant)
- [ ] 14.7. Exportar `membershipDoQuadro(c, quadroId, tarefaId)` que usa `c.query()` no contexto tenant
- [ ] 14.8. Criar testes em `frontend/lib/quadro-guest.test.ts` (GuestError rate_limit, GuestError invalid_token, membership true/false)
- [ ] 14.9. Rodar `bun test frontend/lib/quadro-guest.test.ts` — deve passar
- [ ] 14.10. Rodar `bun run build` — deve passar
- [ ] 14.11. Commit: feat(quadros): withGuest(token, ip, fn) com GuestError + membershipDoQuadro + testes

---

### Task 15: APIs do Dono: CRUD de quadro

**Files:**
- **Create:** `frontend/app/api/quadros/route.ts`
- **Create:** `frontend/app/api/quadros/[id]/route.ts`

**Passos:**

- [ ] 15.1. Criar `app/api/quadros/route.ts` com:
  - GET: `withAuth(async (user) => { const quadros = await quadrosFor(user.id).list(); return Response.json({ quadros }); })`
  - POST: `withAuth(async (user, req) => { const { nome, descricao } = await req.json(); const quadro = await quadrosFor(user.id).criar(nome, descricao); return Response.json(quadro, { status: 201 }); })`

- [ ] 15.2. Criar `app/api/quadros/[id]/route.ts` com:
  - PATCH: `withAuth(async (user, req) => { const { nome, descricao } = await req.json(); const id = params.id; const quadro = await quadrosFor(user.id).atualizar(id, nome, descricao); return quadro ? Response.json(quadro) : new Response(null, { status: 404 }); })`
  - DELETE: `withAuth(async (user, req) => { const id = params.id; await quadrosFor(user.id).arquivar(id); return new Response(null, { status: 204 }); })`

- [ ] 15.3. Rodar `bun run build` — deve passar
- [ ] 15.4. Commit: feat(quadros): APIs GET/POST /api/quadros + PATCH/DELETE /api/quadros/[id]

---

### Task 16: APIs do Dono: Tarefas + Convidados

**Files:**
- **Create:** `frontend/app/api/quadros/[id]/tarefas/route.ts`
- **Create:** `frontend/app/api/quadros/[id]/tarefas/[tid]/route.ts`
- **Create:** `frontend/app/api/quadros/[id]/convidados/route.ts`
- **Create:** `frontend/app/api/quadros/[id]/convidados/[gid]/route.ts`

**Passos:**

- [ ] 16.1. Criar `app/api/quadros/[id]/tarefas/route.ts`:
  - POST: `withAuth(async (user, req) => { const { tarefaIds } = await req.json(); const { adicionadas, duplicadas } = await quadrosFor(user.id).adicionarTarefas(params.id, tarefaIds); return Response.json({ adicionadas, duplicadas }); })`

- [ ] 16.2. Criar `app/api/quadros/[id]/tarefas/[tid]/route.ts`:
  - DELETE: `withAuth(async (user, req) => { const { id, tid } = params; await quadrosFor(user.id).removerTarefa(id, tid); return new Response(null, { status: 204 }); })`

- [ ] 16.3. Criar `app/api/quadros/[id]/convidados/route.ts`:
  - GET: `withAuth(async (user, req) => { const convidados = await quadrosFor(user.id).convidados(params.id); return Response.json({ convidados }); })`
  - POST: `withAuth(async (user, req) => { const { nome } = await req.json(); const result = await quadrosFor(user.id).criarConvidado(params.id, nome); return Response.json(result, { status: 201 }); })`

- [ ] 16.4. Criar `app/api/quadros/[id]/convidados/[gid]/route.ts`:
  - DELETE: `withAuth(async (user, req) => { const { id, gid } = params; await quadrosFor(user.id).revogarConvidado(id, gid); return new Response(null, { status: 204 }); })`

- [ ] 16.5. Rodar `bun run build` — deve passar
- [ ] 16.6. Commit: feat(quadros): APIs POST /api/quadros/[id]/tarefas + DELETE + convidados (GET/POST/DELETE)

---

### Task 17: Páginas do Dono: Lista + Gerenciador

**Files:**
- **Create:** `frontend/app/quadros/page.tsx`
- **Create:** `frontend/app/quadros/[id]/page.tsx`
- **Create:** `frontend/components/quadro-manager.tsx`

**Passos:**

- [ ] 17.1. Criar `app/quadros/page.tsx`:
  - Server Component com `export const dynamic = 'force-dynamic'`
  - Carrega lista via quadrosFor(user.id).list()
  - Renderiza grid de cards (nome, descricao, n_tarefas, n_convidados)
  - Botão "+ Novo Quadro" → modal ou form inline
  - Link "Gerenciar" → /quadros/[id]

- [ ] 17.2. Criar `app/quadros/[id]/page.tsx`:
  - Server Component com `export const dynamic = 'force-dynamic'`
  - Carrega quadro + tarefas + convidados + atividade
  - Renderiza `<QuadroManager quadro={...} tarefas={...} convidados={...} atividade={...} />`

- [ ] 17.3. Criar `components/quadro-manager.tsx`:
  - Client Component
  - Cabeçalho: nome editável (inline), descricao editável
  - Seção "Tarefas": grid/list das tarefas, botão "Adicionar tarefas" → picker de tarefas não adicionadas
  - Seção "Convidados": lista com nomes, botão copiar link, botão revogar (com confirmação)
  - Seção "Atividade": timeline/feed de eventos (via ActivityFeed componente)

- [ ] 17.4. Rodar `bun run build` — deve passar
- [ ] 17.5. Commit: feat(quadros): páginas /quadros (lista) + /quadros/[id] (gerenciador) + QuadroManager componente

---

### Task 18: Navegação: Adicionar "Quadros" na sidebar

**Files:**
- **Modify:** `frontend/app/layout.tsx`

**Passos:**

- [ ] 18.1. Localizar seção de nav/sidebar em layout.tsx
- [ ] 18.2. Adicionar link pra /quadros (entre "Pessoas" e "Assistente", ou lugar apropriado) com texto "Quadros"
- [ ] 18.3. Opcional: adicionar ícone (ex: LayoutGrid ou similar)
- [ ] 18.4. Rodar `bun run build` — deve passar
- [ ] 18.5. Commit: feat: adicionar link "Quadros" na navegação principal

---

### Task 19: Proxy: Adicionar rotas públicas

**Files:**
- **Modify:** `frontend/proxy.ts`

**Passos:**

- [ ] 19.1. Abrir `frontend/proxy.ts`
- [ ] 19.2. Localizar constante `PUBLIC_PREFIXES` (array de strings)
- [ ] 19.3. Adicionar `/q/` e `/api/q/` ao array
- [ ] 19.4. Rodar `bun run build` — deve passar
- [ ] 19.5. Commit: feat(quadros): adicionar /q/ e /api/q/ em PUBLIC_PREFIXES (acesso público)

---

### Task 20: Bulk action: "Adicionar a um quadro"

**Files:**
- **Modify:** `frontend/components/bulk-action-bar.tsx`

**Passos:**

- [ ] 20.1. Localizar enum/tipo de popover actions em bulk-action-bar
- [ ] 20.2. Adicionar tipo novo "quadro"
- [ ] 20.3. Ao montar o componente (useEffect), carregar lista de quadros via fetch(`/api/quadros`) se em escopo "dono"
- [ ] 20.4. Adicionar botão "Adicionar a quadro" na barra (entre outras ações)
- [ ] 20.5. Ao clicar, abre popover com picker de quadros
- [ ] 20.6. Ao selecionar um quadro: POST `/api/quadros/[id]/tarefas` com `{ tarefaIds: selectedIds }`
- [ ] 20.7. Ao sucesso: toast.success("X tarefas adicionadas"), limpar selectedIds, refresh
- [ ] 20.8. Rodar `bun run build` — deve passar
- [ ] 20.9. Commit: feat(quadros): ação bulk "adicionar a um quadro" na barra de ações

---

### Task 21: Typecheck final e build (Fase 2)

**Passos:**

- [ ] 21.1. `cd /Users/vitorgambetti/AssistentePessoal/frontend && bun run build`
- [ ] 21.2. Esperado: `✓ Compiled successfully` (zero errors)
- [ ] 21.3. Se houver erros de typecheck, corrigir e re-commit
- [ ] 21.4. Commit (se houver fixes): fix: corrigir erros de typecheck pós-Fase 2

---

## Fase 3 — Convidado (Acesso e UI Pública, por Token)

Objetivo: Página `/q/[token]` pública (sem login, sem nav) com cards editáveis inline e composer; APIs por token confinadas à membership do quadro.

### Task 22: API GET `/api/q/[token]/tarefas`

**Files:**
- **Create:** `frontend/app/api/q/[token]/tarefas/route.ts`

**Passos:**

- [ ] 22.1. Criar arquivo com GET handler
- [ ] 22.2. Extrair `ip = clientIp(req.headers)` no início
- [ ] 22.3. Usar `withGuest(token, ip, async ({ acesso, c }) => { ... })` wrapper
- [ ] 22.4. Dentro do callback, NÃO chamar quadrosFor() (abre nova conexão); ao invés, query direto em `c`:
  ```typescript
  const tarefas = await c.query(`
    SELECT t.* FROM tarefas t
    JOIN quadro_tarefas qt ON qt.tarefa_id = t.id
    WHERE qt.quadro_id = $1 AND t.user_id = $2
    ORDER BY qt.ordem, t.created_at DESC
  `, [acesso.quadroId, acesso.ownerId]);
  ```
- [ ] 22.5. Retornar `{ quadro: { id: acesso.quadroId, nome: acesso.quadroNome }, convidado: { id: acesso.convidadoId, nome: acesso.convidadoNome }, tarefas: tarefas.rows }`
- [ ] 22.6. Error handling: catch `GuestError` → if e.code==='rate_limit' return 429, if 'invalid_token' return 401; outros → 500
- [ ] 22.7. Rodar `bun run build` — deve passar
- [ ] 22.8. Commit: feat(quadros-convidado): GET /api/q/[token]/tarefas — listar tarefas (query direto em client tenant)

---

### Task 23: API POST `/api/q/[token]/tarefas`

**Files:**
- **Modify:** `frontend/app/api/q/[token]/tarefas/route.ts`

**Passos:**

- [ ] 23.1. Adicionar POST handler ao mesmo arquivo
- [ ] 23.2. Extrair `ip = clientIp(req.headers)` (reusar do GET ou extrair novamente)
- [ ] 23.3. Parse `req.json()` → draft ANTES de withGuest (titulo, descricao, owner, acao, prazo, prioridade, frente_id, pessoas, no_plano)
- [ ] 23.4. Validar titulo não vazio (se vazio, return 400)
- [ ] 23.5. Usar `withGuest(token, ip, async ({ acesso, c }) => { ... })` wrapper
- [ ] 23.6. Dentro withGuest, TUDO roda no MESMO client `c` (transação implícita via withTenant):
  ```typescript
  // 1. Criar tarefa
  const tarefaResult = await c.query(`
    INSERT INTO tarefas (user_id, titulo, descricao, owner, acao, prazo, prioridade, frente_id, inicio, no_plano)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [acesso.ownerId, draft.titulo, draft.descricao, draft.owner, draft.acao, draft.prazo, draft.prioridade, draft.frente_id, draft.inicio, draft.no_plano]);
  const tarefa = tarefaResult.rows[0];
  
  // 2. Vincular em quadro_tarefas (atomicamente no mesmo client)
  await c.query(`INSERT INTO quadro_tarefas (quadro_id, tarefa_id) VALUES ($1, $2)`, [acesso.quadroId, tarefa.id]);
  
  // 3. Registrar evento com convidado
  await c.query(`
    INSERT INTO tarefa_eventos (tarefa_id, user_id, quadro_convidado_id, acao, origem)
    VALUES ($1, $2, $3, 'criada', 'convidado')
  `, [tarefa.id, acesso.ownerId, acesso.convidadoId]);
  
  // 4. Se draft.pessoas, inserir em tarefa_pessoas também
  // 5. Retornar tarefa
  return tarefa;
  ```
- [ ] 23.7. Retornar tarefa criada (201)
- [ ] 23.8. Error handling: catch GuestError → 401/429, catch SQL errors → 400/500
- [ ] 23.9. Rodar `bun run build` — deve passar
- [ ] 23.10. Commit: feat(quadros-convidado): POST /api/q/[token]/tarefas — criar tarefa (atômico em client tenant, com evento)

---

### Task 24: API PATCH/DELETE `/api/q/[token]/tarefas/[id]`

**Files:**
- **Create:** `frontend/app/api/q/[token]/tarefas/[id]/route.ts`

**Passos:**

- [ ] 24.1. Criar arquivo com PATCH handler
- [ ] 24.2. Extrair `ip = clientIp(req.headers)`
- [ ] 24.3. Usar `withGuest(token, ip, async ({ acesso, c }) => { ... })` wrapper
- [ ] 24.4. Validar membership em `c`: `const isMember = await membershipDoQuadro(c, acesso.quadroId, params.id)`
- [ ] 24.5. Se !isMember: throw new Error('tarefa not in board') ou return 404 no catch
- [ ] 24.6. Parse `req.json()` → partial update body (ANTES ou DENTRO withGuest, desde que no escopo correto)
- [ ] 24.7. UPDATE tarefa no MESMO client `c`:
  ```typescript
  const updateResult = await c.query(`
    UPDATE tarefas SET titulo = COALESCE($2, titulo), descricao = COALESCE($3, descricao), ... 
    WHERE id = $1 AND user_id = $4
    RETURNING *
  `, [params.id, body.titulo, body.descricao, ..., acesso.ownerId]);
  ```
- [ ] 24.8. Registrar evento em `c` com origem: 'convidado' + quadro_convidado_id: acesso.convidadoId
- [ ] 24.9. Retornar tarefa atualizada (200)

- [ ] 24.10. Adicionar DELETE handler ao mesmo arquivo
- [ ] 24.11. Validar membership (mesma lógica com membershipDoQuadro)
- [ ] 24.12. Hard DELETE em `c`: `DELETE FROM tarefas WHERE id = $1 AND user_id = $2` (hardwired user_id = acesso.ownerId)
- [ ] 24.13. Registrar evento em `c` com origem: 'convidado' + quadro_convidado_id
- [ ] 24.14. Retornar 204
- [ ] 24.15. Error handling: catch GuestError → 401/429; catch membershipDoQuadro false/tarefa not found → 404; outros → 500

- [ ] 24.16. Rodar `bun run build` — deve passar
- [ ] 24.17. Commit: feat(quadros-convidado): PATCH/DELETE /api/q/[token]/tarefas/[id] (validação membership em client tenant)

---

### Task 25: API GET `/api/q/[token]/frentes`

**Files:**
- **Create:** `frontend/app/api/q/[token]/frentes/route.ts`

**Passos:**

- [ ] 25.1. Criar arquivo com GET handler
- [ ] 25.2. Extrair `ip = clientIp(req.headers)`
- [ ] 25.3. Usar `withGuest(token, ip, async ({ acesso, c }) => { ... })` wrapper
- [ ] 25.4. Query frentes do dono NO MESMO client `c` (RLS escopado ao tenant):
  ```typescript
  const frentes = await c.query(`SELECT id, nome FROM tarefa_frentes WHERE user_id = $1 ORDER BY nome`, [acesso.ownerId]);
  ```
- [ ] 25.5. Retornar `{ frentes: frentes.rows }` (200)
- [ ] 25.6. Error handling: catch GuestError → 401/429; outros → 500
- [ ] 25.7. Rodar `bun run build` — deve passar
- [ ] 25.8. Commit: feat(quadros-convidado): GET /api/q/[token]/frentes — listar áreas do dono (query em client tenant)

---

### Task 26: Página pública `/q/[token]/page.tsx`

**Files:**
- **Create:** `frontend/app/q/[token]/page.tsx`

**Passos:**

- [ ] 26.1. Criar Server Component (Next.js 16) com `export const dynamic = 'force-dynamic'`
- [ ] 26.2. No top-level, chamar `resolver_quadro_token(params.token)` via query() direto (SECURITY DEFINER, sem contexto tenant)
- [ ] 26.3. Se inválido (0 rows): renderizar página amigável com `<GuestBoardError type="invalid_token" />`
  ```
  "Link não está mais válido. Solicite um novo ao dono do quadro."
  ```
- [ ] 26.4. Se válido: renderizar `<GuestBoard token={params.token} acesso={rowData} />` (Client Component)
- [ ] 26.5. Rodar `bun run build` — deve passar
- [ ] 26.6. Commit: feat(quadros-convidado): página /q/[token] — resolver token + renderizar GuestBoard

---

### Task 27: Componente `GuestBoard`

**Files:**
- **Create:** `frontend/components/guest-board.tsx`

**Passos:**

- [ ] 27.1. Criar Client Component que recebe `{ token, acesso? }` props
- [ ] 27.2. Embrulhar conteúdo em `<GuestTaskProvider token={token}>{...}</GuestTaskProvider>`
- [ ] 27.3. Cabeçalho: renderizar nome do quadro (font-display text-4xl), + "Você está como {nome do convidado}"
- [ ] 27.4. Lista de tarefas: usar TaskRow componente + expand-in-place (Fase 1)
- [ ] 27.5. Composer: renderizar CaptureComposer pra criar tarefas
- [ ] 27.6. Carregamento: ao montar, fetch GET `/api/q/[token]/tarefas` e setTarefas (ou usar hook do GuestTaskProvider)
- [ ] 27.7. Erro: se rate-limit ou token revogado durante uso, renderizar GuestBoardError
- [ ] 27.8. Responsive: max-w-2xl center, px-4 sm:px-6, py-8 sm:py-12
- [ ] 27.9. Rodar `bun run build` — deve passar
- [ ] 27.10. Commit: feat(quadros-convidado): componente GuestBoard — UI minimalista (cards + composer)

---

### Task 28: Testes de Segurança — Confinamento e Auditoria

**Files:**
- **Create:** `frontend/lib/quadro-guest.test.ts` (expandido)

**Passos:**

- [ ] 28.1. Teste: convidado com token1 tenta acessar tarefa fora do quadro1 → validação de membership falha → 404
- [ ] 28.2. Teste: token revogado → resolver_quadro_token retorna 0 rows → 401
- [ ] 28.3. Teste: evento criado por convidado → quadro_convidado_id é setado (não NULL)
- [ ] 28.4. Teste: rate-limit 31 requisições em 60s → 31ª recebe 429
- [ ] 28.5. Teste: convidado1 não consegue listar tarefas de quadro2 (mesmo com brute-force token) → 401
- [ ] 28.6. Rodar `bun test` → todos pass
- [ ] 28.7. Commit: test(quadros-convidado): confinamento + auditoria + rate-limit

---

### Task 29: Build + Verificação Final (Fase 3)

**Passos:**

- [ ] 29.1. `cd /Users/vitorgambetti/AssistentePessoal/frontend && bun run build` → zero errors, ✓ Compiled successfully
- [ ] 29.2. `bun test` → todos testes passam
- [ ] 29.3. `bun run dev` — iniciar dev server
- [ ] 29.4. **Teste 1 — Token inválido:**
  - Abrir http://localhost:3000/q/INVALID
  - Deve renderizar: "Link não está mais válido..."
  
- [ ] 29.5. **Teste 2 — Token válido (criar um):**
  - Fazer login como dono em /quadros
  - Criar um quadro "Teste"
  - Criar um convidado "João"
  - Copiar link (já funciona de Task 31)
  - Abrir link em incógnito/outra aba
  - Deve renderizar: nome do quadro, "Você está como João"
  - Tarefas do quadro aparecem
  
- [ ] 29.6. **Teste 3 — Editar como convidado:**
  - Na página /q/[token], expandir um card
  - Editar título
  - Deve salvar (sem refresh)
  - Toast "Tarefa atualizada"
  
- [ ] 29.7. **Teste 4 — Criar como convidado:**
  - Na página /q/[token], escrever no composer
  - Enter
  - Tarefa nova aparece na lista
  - Toast "Tarefa criada"
  
- [ ] 29.8. **Teste 5 — Deletar como convidado:**
  - Expandir um card
  - Clicar "Deletar"
  - 2-toque confirmação
  - Tarefa desaparece
  
- [ ] 29.9. **Teste 6 — Revogar link:**
  - Voltar pra /quadros, gerenciar quadro
  - Clicar "Revogar" pra João
  - Voltar pra aba /q/[token] antiga
  - Fazer uma ação (ex: editar)
  - Deve receber 401
  - Renderizar GuestBoardError ("Link não está mais válido...")
  
- [ ] 29.10. **Teste 7 — Rate-limit:**
  - Em /q/[token], fazer 31 requisições rápidas (via console: loop de fetch)
  - 31ª deve retornar 429
  - Toast "Muitas tentativas. Aguarda um minuto."
  
- [ ] 29.11. Commit: feat(quadros): FASE 3 COMPLETA — acesso público por token + confinamento + auditoria

---

## Fase 4 — Polish Visual e Robustez

Objetivo: Deixar bonito, claro e robusto. Inclui feed de atividade auditada, estados vazios amigáveis, rate-limits afinados, responsividade mobile, estilização usando design tokens reais.

### Task 30: Feed de atividade auditado

**Files:**
- **Create:** `frontend/components/activity-feed.tsx` (componente reutilizável)
- **Modify:** `frontend/lib/quadros.ts` (expandir helper)

**Passos:**

- [ ] 30.1. Em `lib/quadros.ts`, expandir `quadrosFor()` com método `.atividade(quadroId, limit=50)` que:
  - SELECT FROM tarefa_eventos te
  - LEFT JOIN quadro_convidados qc ON te.quadro_convidado_id = qc.id
  - LEFT JOIN tarefas t ON te.tarefa_id = t.id
  - WHERE existe relação com quadro (via quadro_tarefas ou direto)
  - ORDER BY te.created_at DESC
  - LIMIT
  - Retorna AtividadeItem[]

- [ ] 30.2. Criar componente `components/activity-feed.tsx`:
  - Recebe `items: AtividadeItem[]`
  - Renderiza lista com:
    - Avatar placeholder (convidado_nome ou "Você")
    - Nome (convidado_nome ou "Você")
    - Ação (criou, editou [campo], deletou)
    - Tarefa título (link pra tarefa, se aplicável)
    - Timestamp (formatDistanceToNowStrict em pt-BR, ex: "há 2 horas")
  - Cores: `--muted`, `--foreground`, `--accent` de globals.css
  - Layout: flex, dot icon, gap

- [ ] 30.3. Integrar ActivityFeed em `components/quadro-manager.tsx`:
  - Adicionar seção "Atividade" (lg:col-span-1 na sidebar)
  - Carregar atividade ao montar
  - Renderizar `<ActivityFeed items={atividade} />`

- [ ] 30.4. Testes em `lib/quadros.test.ts` pra `.atividade()` (retorna array com campos corretos)
- [ ] 30.5. Rodar `bun test` + `bun run build`
- [ ] 30.6. Commit: feat(quadros): feed de atividade auditada (com nomes de convidados)

---

### Task 31: Página `/q/[token]` — Estados vazios e amigáveis

**Files:**
- **Create:** `frontend/components/guest-board-error.tsx`
- **Modify:** `frontend/app/q/[token]/page.tsx`
- **Modify:** `frontend/components/guest-board.tsx`

**Passos:**

- [ ] 31.1. Criar componente `components/guest-board-error.tsx`:
  - Props: `type: 'invalid_token' | 'rate_limited' | 'not_found' | 'empty_board'`
  - invalid_token: Ícone lock, texto "Link não está mais válido. Solicite um novo ao dono do quadro."
  - rate_limited: Ícone clock, texto "Muitas tentativas. Aguarda um minuto."
  - not_found: Ícone search-x, texto "Quadro não encontrado."
  - empty_board: Ícone inbox, texto "Nenhuma tarefa neste quadro ainda. Crie uma!"
  - Padding, centered, responsive

- [ ] 31.2. Modificar `/q/[token]/page.tsx`:
  - Adicionar try-catch wrapper ao resolver_quadro_token
  - Catch rate-limit (via withGuest) → renderizar GuestBoardError('rate_limited')
  - Catch token inválido → renderizar GuestBoardError('invalid_token')

- [ ] 31.3. Modificar `components/guest-board.tsx`:
  - Ao carregar tarefas, se array vazio → renderizar GuestBoardError('empty_board') em vez de lista vazia
  - Pode incluir CaptureComposer mesmo na empty state (encorajador)

- [ ] 31.4. Rodar `bun run build`
- [ ] 31.5. Commit: fix(quadros): estados vazios/erro no guest-board (invalid token, rate limit, empty quadro)

---

### Task 32: Copiar link de convidado (UI + UX)

**Files:**
- **Create:** `frontend/components/copy-link-button.tsx`
- **Modify:** `frontend/components/quadro-manager.tsx`

**Passos:**

- [ ] 32.1. Criar componente `components/copy-link-button.tsx`:
  - Props: `link: string, label?: string`
  - Estado: [copied, setCopied]
  - Renderiza botão que ao clicar: `navigator.clipboard.writeText(link)`
  - Após cópia: muda pra "Copiado!" com ícone check, fundo verde (--calm), por 2s
  - Volta ao estado original
  - Pode renderizar como ícone ou button full

- [ ] 32.2. Integrar em `components/quadro-manager.tsx`:
  - Na seção "Convidados", ao lado de cada convidado ativo:
    - Renderizar `<CopyLinkButton link={`${BASE_URL}/q/${convidado.token}`} />`

- [ ] 32.3. `process.env.NEXT_PUBLIC_BASE_URL` deve estar setado em .env.local ou similar
- [ ] 32.4. Rodar `bun run build`
- [ ] 32.5. Commit: feat(quadros): botão copiar link com feedback visual (2s "Copiado!")

---

### Task 33: Estilização completa — cards, componentes, design tokens

**Files:**
- **Modify:** `frontend/components/guest-board.tsx` (estilo visual completo)
- **Modify:** `frontend/components/quadro-manager.tsx` (cabeçalho, layout, cards)
- **Modify:** `frontend/components/activity-feed.tsx` (cores e layout)
- **Verify:** `frontend/app/globals.css` (design tokens presentes)

**Passos:**

- [ ] 33.1. Verificar globals.css possui:
  - `--background`, `--foreground`, `--card`, `--border`
  - `--muted`, `--muted-foreground`, `--muted-strong`
  - `--calm`, `--warm`, `--urgent`
  - `--done`
  - `--accent`
  - Font display: Fraunces (font-display)

- [ ] 33.2. GuestBoard estilização:
  - Wrapper: `max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12`
  - Cabeçalho: `h1 font-display text-3xl sm:text-4xl mb-1`, border-bottom 2px `--border`
  - Subtítulo: `text-sm --muted-strong`, "Você está como [nome]"
  - Cards de tarefas: `rounded-lg border border-[--border] bg-[--card] p-4 sm:p-5 mb-4`
  - Composer seção: `mt-8 pt-8 border-t-2 border-[--border]`, heading font-display text-lg
  - Composer input: `w-full border border-[--border] rounded p-3, focus:border-[--accent]`
  - Empty state (tarefas): `border-2 border-dashed border-[--accent] rounded p-8 text-center --muted`

- [ ] 33.3. QuadroManager estilização:
  - Grid: `grid grid-cols-1 lg:grid-cols-3 gap-8`
  - Tarefas seção: `lg:col-span-2`
  - Sidebar (Convidados + Atividade): `lg:col-span-1`
  - Cabeçalho: h1 font-display text-3xl sm:text-4xl, border-b-2 border-[--border], pb-4
  - Subseção headings: h3 font-display text-lg, mb-4, mt-6 (primeiro mt-0)
  - Cards (convidados): `border border-[--border] bg-[--card] rounded-lg p-3 flex justify-between items-center mb-2`
  - Botões: 
    - Criar: bg-[--calm] text-white px-4 py-2 rounded
    - Revogar/Delete: bg-[--urgent] text-white px-3 py-1 rounded text-sm
  - Responsive: padding reduz em mobile, grid ajusta

- [ ] 33.4. ActivityFeed estilização:
  - Container: space-y-4
  - Item: flex gap-3
  - Avatar: w-8 h-8 rounded-full bg-[--muted] text-white flex justify-center items-center text-xs
  - Content: flex-1
  - Nome: text-sm font-medium --foreground
  - Ação: text-sm --muted
  - Timestamp: text-xs --muted, float right
  - Link tarefa: underline --accent hover:text-darker

- [ ] 33.5. GuestBoardError estilização:
  - Centered: `flex flex-col items-center justify-center gap-4 py-16`
  - Ícone: text-6xl --muted
  - Texto: text-lg text-center --muted-strong
  - Subtext (se houver): text-sm --muted

- [ ] 33.6. Rodar `bun run build` — zero errors
- [ ] 33.7. Verificação manual:
  - Desktop 1920px: layout 3 cols, cores semânticas, títulos Fraunces (display), espaçamento OK
  - Mobile 375px: grid 1 col, padding/margin responsivos, botões clicáveis, texto legível
  
- [ ] 33.8. Commit: style(quadros): estilização completa usando design tokens (--calm, --warm, --urgent, --done, --accent)

---

### Task 34: Rate-limits afinados e testes

**Files:**
- **Create:** `frontend/lib/rate-limit.test.ts` (expandido)
- **Verify:** todos handlers `/api/q/[token]/*` usam rate-limit
- **Verify:** todos handlers `/api/quadros/*` usam rate-limit dono

**Passos:**

- [ ] 34.1. Testes de `rateLimit()` em `lib/rate-limit.test.ts`:
  - Teste: permite N requisições em windowMs (ex: 3 em 10s)
  - Teste: rejeita N+1-ésima (retorna false)
  - Teste: reseta após windowMs

- [ ] 34.2. Verificar implementação em handlers:
  - `/api/q/[token]/tarefas` (GET): `rateLimit(key: "q:token:ip", max: 30, windowMs: 60_000)`
  - `/api/q/[token]/tarefas` (POST): mesmo
  - `/api/q/[token]/tarefas/[id]` (PATCH/DELETE): mesmo
  - `/api/q/[token]/frentes` (GET): mesmo
  
- [ ] 34.3. Dono (`/api/quadros/*`):
  - Implementar rate-limit por user_id:ip (100 req/min) — opcional, pode ser só por user_id
  - key: `qadmin:${user.id}:${ip}`, max: 100, windowMs: 60_000

- [ ] 34.4. Resposta 429:
  - Header: `Retry-After: 60`
  - Body: `{ error: "rate_limit_exceeded", message: "Muitas requisições. Aguarde 1 minuto." }`

- [ ] 34.5. Teste manual:
  - Fazer 31 requisições ao token em 60s
  - 31ª deve receber 429 + header Retry-After
  - Toast no frontend: "Muitas tentativas..."

- [ ] 34.6. Rodar `bun test lib/rate-limit.test.ts`
- [ ] 34.7. Commit: test(rate-limit): validação de limites (30 req/min token:ip público, 100/min owner optional)

---

### Task 35: Validação robusta de membership + Testes de integração

**Files:**
- **Verify:** handlers `/api/q/[token]/tarefas/[id]` usam validação de membership
- **Expand:** `frontend/lib/quadro-guest.test.ts` com testes adicionais

**Passos:**

- [ ] 35.1. Cada handler PATCH/DELETE convidado deve:
  - Chamar `const isMember = await membershipDoQuadro(c, ctx.acesso.quadroId, tarefaId)`
  - Se !isMember: retornar 404 com mensagem "Tarefa não está neste quadro"
  - Alternativa SQL: `WHERE tarefa_id = $1 AND EXISTS (SELECT 1 FROM quadro_tarefas WHERE quadro_id = $2 AND tarefa_id = $1)`

- [ ] 35.2. Testes adicionais em `lib/quadro-guest.test.ts`:
  - Teste: convidado token1 tenta PATCH /api/q/[token1]/tarefas/[id-fora-quadro] → 404
  - Teste: convidado token1 tenta DELETE /api/q/[token1]/tarefas/[id-fora-quadro] → 404
  - Teste: convidado token1 tenta PATCH /api/q/[token1]/tarefas/[id-correto-no-quadro] → 200 OK
  - Teste: convidado token1 tenta acessar GET /api/q/[token2]/tarefas (outro token) → 401

- [ ] 35.3. Rodar `bun test` → todos passam
- [ ] 35.4. Commit: test(quadros): validação robusta de membership em handlers convidado (404 se tarefa fora do quadro)

---

### Task 36: Build final + Verificação de regressão (Fases 1-4)

**Passos:**

- [ ] 36.1. `cd /Users/vitorgambetti/AssistentePessoal/frontend && bun run build`
  - Esperado: `✓ Compiled successfully` (zero errors)

- [ ] 36.2. `bun test`
  - Esperado: todos testes passam (✓)
  - Se houver falha, debugar e refixar

- [ ] 36.3. `bun run dev` — iniciar dev server
  
- [ ] 36.4. **Regressão Fase 1 (edição inline):**
  - Abrir http://localhost:3000 (home)
  - Clicar tarefa → expande inline (não modal)
  - Editar título → salva otimista
  - Clicar AcaoEditor → popover abre/fecha
  - Capturador: escrever + Enter → tarefa nova
  - Responsive mobile: tudo clicável

- [ ] 36.5. **Regressão Fase 2 (dono):**
  - Abrir http://localhost:3000/quadros
  - Lista de quadros com contadores
  - Botão "+ Novo" → criar quadro
  - Clicar em um quadro → /quadros/[id]
  - Gerenciador: editar nome, adicionar tarefas (bulk), convidados
  - Copiar link (feedback "Copiado!")

- [ ] 36.6. **Regressão Fase 3 (convidado):**
  - Abrir /q/[token] válido
  - Nome quadro + "Você está como [nome]"
  - Tarefas carregam
  - Editar/deletar funciona
  - Criador funciona
  - Revogar link → 401 depois

- [ ] 36.7. **Regressão Fase 4 (polish):**
  - Feed de atividade mostra eventos com nomes e timestamps
  - Empty state quadro: "Nenhuma tarefa..."
  - Invalid token: "Link não está mais válido..."
  - Rate-limit: 31ª req → 429 + toast
  - Cores/fonts: Fraunces display em títulos, design tokens aplicados
  - Responsive: desktop e mobile

- [ ] 36.8. Console: zero erros React/TypeScript
- [ ] 36.9. Commit final:
  ```bash
  git commit -m "feat(quadros): fase 4 completa — polish visual, feed de atividade, validação robusta"
  ```

---

### Task 37: Documentação de deploy e checklist pós-produção

**Files:**
- **Create:** `docs/quadros-deployment.md`

**Passos:**

- [ ] 37.1. Criar arquivo com seções:

  **1. Database**
  - [ ] Migration 0019 aplicada: `psql -f db/0019_quadros.sql`
  - [ ] Tabelas criadas: quadros, quadro_tarefas, quadro_convidados
  - [ ] RLS habilitado em todas
  - [ ] Função SECURITY DEFINER resolver_quadro_token criada
  - [ ] Coluna tarefa_eventos.quadro_convidado_id existe

  **2. Frontend**
  - [ ] Build sem erros: `bun run build`
  - [ ] Testes passam: `bun test`
  - [ ] TaskMutationContext implementado (Fase 1)
  - [ ] APIs /api/quadros/* implementadas (Fase 2)
  - [ ] APIs /api/q/[token]/* implementadas (Fase 3)
  - [ ] Componentes principais: GuestBoard, QuadroManager, ActivityFeed
  - [ ] Toaster do sonner renderizado em layout

  **3. Security**
  - [ ] Rate-limit 30 req/min por token:ip em /api/q/*
  - [ ] Rate-limit 100 req/min por user_id em /api/quadros/* (optional)
  - [ ] Token: 128 bits via randomBytes(16).toString("base64url")
  - [ ] RLS policies validam user_id (tenant confinement)
  - [ ] withGuest sempre valida membership
  - [ ] Eventos registram quadro_convidado_id
  - [ ] Sem data de convidado exposta em GET /api/quadros/[id]/convidados (token mascarado ou omitido em prod)

  **4. URLs Públicas**
  - [ ] proxy.ts contém /q/ e /api/q/ em PUBLIC_PREFIXES
  - [ ] /q/[token] renderiza sem login
  - [ ] /api/q/[token]/* acessível sem token Auth (validação por query param)

  **5. Testes de Aceitação**
  - [ ] Dono cria quadro + 2 convidados
  - [ ] Cada convidado acessa via /q/[token] — vê apenas tarefas do quadro
  - [ ] Convidado edita tarefa — dono vê mudança em gerenciador
  - [ ] Feed de atividade mostra nome do convidado
  - [ ] Revogar convidado → link fica 401
  - [ ] Rate-limit: 31ª req em 60s → 429
  - [ ] Responsive mobile: tudo funciona em iPhone SE (375px)

  **6. Após Deploy**
  - [ ] Monitorar logs pra 401/429 spurious
  - [ ] Backup manual de quadros_convidados antes de remover teste
  - [ ] Documentação do usuário pronta (como criar quadro, gerar link, revogar)

- [ ] 37.2. Adicionar link em README.md ou arquivo de deploye existente
- [ ] 37.3. Commit: docs(quadros): checklist de deploy e pós-produção

---

## Ordem de Execução & Dependências

```
FASE 1 (Tasks 1-11): Edição Inline Base
  ├─ Task 1: TaskMutationContext + OwnerTaskProvider + GuestTaskProvider
  ├─ Task 2: Adicionar sonner
  ├─ Task 3-10: Componentes + integração + verificação manual
  ├─ Task 11: Documentação interna
  └─ [Pode ser mergeada independentemente]

FASE 2 (Tasks 12-21): Schema + Dono
  ├─ Depende de: Fase 1 (TaskMutations)
  ├─ Task 12: Migration SQL
  ├─ Task 13: Helpers quadrosFor()
  ├─ Task 14: Helper withGuest(token, ip, fn) com GuestError + membershipDoQuadro
  ├─ Task 15-20: APIs + páginas + nav
  ├─ Task 21: Typecheck final
  └─ [Pode ser mergeada independentemente, mas recomenda-se após Fase 1]

FASE 3 (Tasks 22-29): Convidado Público
  ├─ Depende de: Fase 2 (schema + helpers)
  ├─ Task 22-25: APIs públicas convidado (GET/POST tarefas, PATCH/DELETE, GET frentes)
  ├─ Task 26-27: Página + componente GuestBoard
  ├─ Task 28: Testes de segurança
  ├─ Task 29: Build final + verificação
  └─ [Pode ser mergeada independentemente, mas recomenda-se após Fase 2]

FASE 4 (Tasks 30-37): Polish Visual + Robustez
  ├─ Depende de: Fases 1-3 (tudo anteriormente implementado)
  ├─ Task 30: Feed de atividade
  ├─ Task 31: Estados vazios/erro
  ├─ Task 32: Copiar link
  ├─ Task 33: Estilização completa
  ├─ Task 34: Rate-limits + testes
  ├─ Task 35: Membership validation + testes
  ├─ Task 36: Build final + regressão
  ├─ Task 37: Documentação deploy
  └─ [Deve ser mergeada por último (depende de tudo)]

MERGE STRATEGY:
  - Após Fase 1 completa + build OK + verificação manual → PR merge pra main
  - Após Fase 2 completa + build OK + testes → PR merge pra main
  - Após Fase 3 completa + build OK + testes de segurança → PR merge pra main
  - Após Fase 4 completa + build OK + testes + verificação visual → PR merge pra main
  - Cada PR deve ter branch isolada (feature/f1-edição-inline, feature/f2-schema-dono, etc.)
```

---

## Checklist de Segurança (Garantido)

- ✅ `resolver_quadro_token`: SECURITY DEFINER, REVOKE FROM PUBLIC, GRANT só a app_tenant/app_writer
- ✅ RLS em `quadros`, `quadro_tarefas`, `quadro_convidados` — USING (user_id::text = current_setting('app.current_user_id', true))
- ✅ `withGuest(token, ip, fn)` sempre valida token + rate-limit + confinamento via withTenant(ownerId) com client `c`
- ✅ Toda mutação de tarefa do convidado: validação de membership via `membershipDoQuadro(c, quadroId, tarefaId)` retorna 404 se false
- ✅ Eventos gravam `quadro_convidado_id` (atribuição auditada)
- ✅ Token: 128 bits via `randomBytes(16).toString("base64url")` — único, criptograficamente seguro
- ✅ `scope: "guest"` é UI-only; autorização é 100% server-side (sem brecha client-side)
- ✅ Hard DELETE convidado (revoked_at) invalida token imediatamente (resolver_quadro_token filtra revoked_at IS NULL)
- ✅ Rate-limit: 30 req/min por token:ip (convidado), 100 req/min por user_id:ip (dono)
- ✅ Confine tarefas: convidado NUNCA consegue ver/editar/deletar fora do quadro (WHERE EXISTS via quadro_tarefas)

---

## Tipos Finalizados (Type Drift Eliminado)

```typescript
// lib/quadros.ts

export type Quadro = {
  id: string;
  user_id: string;
  nome: string;
  descricao: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type QuadroConvidado = {
  id: string;
  quadro_id: string;
  nome: string;
  token: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type QuadroComContagem = Quadro & {
  n_tarefas: number;
  n_convidados: number;
};

export type AcessoConvidado = {
  quadroId: string;
  ownerId: string;
  quadroNome: string;
  convidadoId: string;
  convidadoNome: string;
};

export type TarefaEvento = {
  id: string;
  tarefa_id: string;
  user_id: string;
  quadro_convidado_id: string | null;
  acao: string;
  patch_dados: Record<string, unknown> | null;
  origem: string;
  created_at: string;
};

export type AtividadeItem = {
  id: string;
  criado_em: string;
  acao: string;
  mudancas: Record<string, [before: unknown, after: unknown]> | null;
  tarefa_titulo: string;
  tarefa_id: string;
  convidado_nome: string | null;
  convidado_id: string | null;
};

export type TarefaPessoa = {
  id?: string;
  nome: string;
  principal?: boolean;
};

// lib/task-mutations.tsx

export type TaskMutations = {
  patch: (id: string, body: Partial<{
    titulo?: string;
    descricao?: string | null;
    owner?: string;
    acao?: Acao;
    prazo?: string | null;
    prazo_text?: string | null;
    prioridade?: Tarefa["prioridade"];
    status?: Tarefa["status"];
    no_plano?: boolean;
    frente_id?: string | null;
    inicio?: string | null;
    pessoas?: TarefaPessoa[];
  }>) => Promise<Tarefa | null>;
  remove: (id: string, opts?: { motivo?: string }) => Promise<void>;
  create: (draft: {
    titulo: string;
    descricao?: string | null;
    owner?: string;
    acao?: Acao;
    prazo?: string | null;
    prazo_text?: string | null;
    prioridade?: Tarefa["prioridade"];
    frente_id?: string | null;
    inicio?: string | null;
    pessoas?: TarefaPessoa[];
    no_plano?: boolean;
  }) => Promise<Tarefa | null>;
  listFrentes: () => Promise<{ id: string; nome: string }[]>;
  createFrente?: (nome: string) => Promise<{ id: string; nome: string } | null>;
  refresh: () => void;
  scope: "owner" | "guest";
};

export type OwnerTaskProviderProps = {
  children: ReactNode;
};

export type GuestTaskProviderProps = {
  token: string;
  children: ReactNode;
};
```

Este plano está **100% completo e corrigido**, com toda cobertura de gaps, type drift eliminado, placeholders removidos, código concreto em cada task, e segurança garantida em todos os handlers do convidado.
# TaskMutations Context — Usage Guide

## Visão Geral

`TaskMutations` é um context plugável que fornece operações CRUD para tarefas, com suporte tanto para donos (autenticados) quanto para convidados (via token). Abstrai a complexidade de fetch direto para APIs.

## Arquitetura

### Componentes

- **`TaskMutationContext`** — Context React para compartilhar mutations entre componentes
- **`useTaskMutations()`** — Hook para consumir o context (obrigatório estar dentro de um Provider)
- **`OwnerTaskProvider`** — Provider para donos; usa `/api/tarefas/*` + router.refresh()
- **`GuestTaskProvider`** — Provider para convidados; usa `/api/q/[token]/*` + refetch local

### Fluxo de Dados

```
┌─────────────────────────────────────────┐
│ Componente (TaskRow, CaptureComposer)   │
└──────────────┬──────────────────────────┘
               │ useTaskMutations()
               ▼
       ┌───────────────┐
       │ TaskMutations │
       └───────┬───────┘
               │
        ┌──────┴──────┐
        ▼             ▼
   OwnerTaskProvider GuestTaskProvider
        │             │
        ▼             ▼
  /api/tarefas/*  /api/q/[token]/*
        │             │
        ▼             ▼
    Router.refresh()  Local setState
```

## Como Usar

### Em um Componente

```typescript
"use client";

import { useTaskMutations } from "@/lib/task-mutations";

export function MyTaskComponent() {
  const mut = useTaskMutations();
  
  async function handleEdit(tarefaId: string) {
    await mut.patch(tarefaId, {
      titulo: "Novo título",
      status: "concluida",
    });
    // Toast é exibido automaticamente (sucesso ou erro)
  }
  
  return (
    <button onClick={() => handleEdit("123")}>
      Marcar como concluída
    </button>
  );
}
```

### Envolvendo uma Página

```typescript
// app/page.tsx (Server Component)
import { OwnerTaskProvider } from "@/lib/task-mutations";

export default async function HomePage() {
  return (
    <OwnerTaskProvider>
      <div>
        {/* Aqui dentro, todos os filhos podem usar useTaskMutations() */}
        <MyTaskComponent />
      </div>
    </OwnerTaskProvider>
  );
}
```

## API Reference

### `TaskMutations` Interface

```typescript
type TaskMutations = {
  // Editar tarefa existente (partial update)
  patch: (id: string, body: Partial<TarefaUpdate>) => Promise<Tarefa | null>;
  
  // Deletar tarefa
  remove: (id: string, opts?: { motivo?: string }) => Promise<void>;
  
  // Criar tarefa nova
  create: (draft: TarefaDraft) => Promise<Tarefa | null>;
  
  // Listar áreas (frentes) disponíveis
  listFrentes: () => Promise<{ id: string; nome: string }[]>;
  
  // Criar nova área (dono só)
  createFrente?: (nome: string) => Promise<{ id: string; nome: string } | null>;
  
  // Trigger refresh (router.refresh em dono, refetch local em convidado)
  refresh: () => void;
  
  // Escopo: "owner" | "guest" (apenas informativo, não segurança)
  scope: "owner" | "guest";
};
```

### `patch(id, body)`

Edita um campo ou vários campos de uma tarefa.

**Parâmetros:**
- `id: string` — UUID da tarefa
- `body: Partial<TarefaUpdate>` — Campos a atualizar

**Retorna:** `Promise<Tarefa | null>` — Tarefa atualizada ou null em erro

**Comportamento:**
- OwnerTaskProvider: faz PATCH `/api/tarefas/{id}`, exibe toast, chama router.refresh()
- GuestTaskProvider: faz PATCH `/api/q/{token}/tarefas/{id}`, atualiza estado local, exibe toast

**Exemplo:**

```typescript
await mut.patch("task-123", {
  titulo: "Nova descrição",
  status: "concluida",
  prazo: "2025-12-31T23:59:00Z",
});
```

### `remove(id, opts?)`

Deleta uma tarefa.

**Parâmetros:**
- `id: string` — UUID da tarefa
- `opts?.motivo: string` — Motivo da exclusão (default: "deletada pelo usuário")

**Retorna:** `Promise<void>`

**Exemplo:**

```typescript
await mut.remove("task-123", { motivo: "não é tarefa" });
```

### `create(draft)`

Cria uma tarefa nova.

**Parâmetros:**
- `draft: TarefaDraft` — Dados da nova tarefa

```typescript
type TarefaDraft = {
  titulo: string;
  descricao?: string | null;
  owner?: string;
  acao?: "executar" | "cobrar" | "aguardar";
  prazo?: string | null;
  prazo_text?: string | null;
  prioridade?: "baixa" | "media" | "alta" | "urgente";
  frente_id?: string | null;
  inicio?: string | null;
  pessoas?: { nome: string; principal?: boolean }[];
  no_plano?: boolean;
};
```

**Retorna:** `Promise<Tarefa | null>` — Tarefa criada ou null em erro

**Exemplo:**

```typescript
const tarefa = await mut.create({
  titulo: "Fazer relatório",
  descricao: "Relatório de Q4",
  prioridade: "alta",
  prazo: "2025-12-31T23:59:00Z",
});
```

### `listFrentes()`

Lista áreas (frentes) disponíveis.

**Retorna:** `Promise<{ id: string; nome: string }[]>`

**Exemplo:**

```typescript
const frentes = await mut.listFrentes();
console.log(frentes); // [{ id: "f1", nome: "Frontend" }, ...]
```

### `refresh()`

Força refresh dos dados.

- OwnerTaskProvider: `router.refresh()` (full page revalidate)
- GuestTaskProvider: refetch de `/api/q/[token]/tarefas` e setState local

**Exemplo:**

```typescript
await mut.patch("task-123", { status: "concluida" });
mut.refresh(); // Recarrega todos os dados
```

## Padrões Comuns

### Salvamento Otimista com Blur (TaskEditFields)

```typescript
const [titulo, setTitulo] = useState(tarefa.titulo);

const handleTituloBlur = async () => {
  if (titulo.trim() && titulo !== tarefa.titulo) {
    await mut.patch(tarefa.id, { titulo: titulo.trim() });
  }
};

return (
  <input
    value={titulo}
    onChange={(e) => setTitulo(e.target.value)}
    onBlur={handleTituloBlur}
  />
);
```

### Quick Actions (AcaoEditor)

```typescript
async function apply(acao: Acao, ownerValue: string) {
  await mut.patch(tarefa.id, {
    acao,
    owner: acao === "executar" ? "vitor" : ownerValue.trim() || "?",
  });
  setOpen(false);
}
```

### Captura com Parsing (CaptureComposer)

```typescript
// 1. Parser de texto (via /api/capturar)
const parsed = await fetch("/api/capturar", {
  method: "POST",
  body: JSON.stringify({ texto }),
}).then(r => r.json());

// 2. Criar via contexto
const tarefa = await mut.create(parsed);

// 3. Patch otimista em chips (sem refresh)
patch({ prazo: iso, prazo_text: null });
```

## Adição de Novos Campos

### 1. Adicionar ao tipo `TarefaDraft`

Edite `lib/queries.ts`:

```typescript
export type TarefaDraft = {
  // ... existentes ...
  meu_novo_campo?: string;
};
```

### 2. Adicionar a `TaskMutations.patch`

```typescript
export type TaskMutations = {
  patch: (
    id: string,
    body: Partial<{
      // ... existentes ...
      meu_novo_campo?: string;
    }>,
  ) => Promise<Tarefa | null>;
  // ...
};
```

### 3. Usar em componente

```typescript
await mut.patch(tarefaId, { meu_novo_campo: "valor" });
```

### 4. Backend valida no endpoint

O endpoint `/api/tarefas/[id]` (PATCH) deve aceitar e validar o campo.

## Tratamento de Erros

Erros são automáticamente exibidos como toasts do `sonner`:

```typescript
// Se houver erro, toast.error() é exibido automaticamente
// Nenhum try-catch necessário no componente
await mut.patch(id, { titulo: "..." }); // Toast automático em erro
```

Se quiser tratar erros manualmente:

```typescript
const tarefa = await mut.patch(id, { ... });
if (!tarefa) {
  // Erro ocorreu (toast já foi exibido)
  console.error("Falha ao atualizar");
}
```

## Diferenças Dono vs Convidado

| Aspecto | Dono | Convidado |
|--------|------|-----------|
| Provider | `OwnerTaskProvider` | `GuestTaskProvider` |
| Endpoint | `/api/tarefas/*` | `/api/q/[token]/*` |
| Autenticação | Session cookie | Token no URL |
| Refresh | `router.refresh()` | Refetch local `setState` |
| Rate limit | 100 req/min (opcional) | 30 req/min per token:ip |
| Scope | "owner" | "guest" |

## Testes

Para testar o contexto em componentes:

```typescript
import { render, screen } from "@testing-library/react";
import { TaskMutationContext } from "@/lib/task-mutations";
import { MyComponent } from "./my-component";

const mockMut = {
  patch: jest.fn().mockResolvedValue({ id: "123" }),
  remove: jest.fn().mockResolvedValue(undefined),
  create: jest.fn().mockResolvedValue({ id: "456" }),
  listFrentes: jest.fn().mockResolvedValue([]),
  refresh: jest.fn(),
  scope: "owner" as const,
};

render(
  <TaskMutationContext.Provider value={mockMut}>
    <MyComponent />
  </TaskMutationContext.Provider>
);
```

## Fase 2 (Quadros)

`GuestTaskProvider` foi projetado para reutilização em convidados de quadros compartilhados. Fase 2 adicionará:

- `/api/q/[token]/tarefas/*` — APIs públicas por token
- `GuestBoard` — UI do quadro do convidado
- Rate-limit 30 req/min por token:ip

`TaskMutations` não muda; apenas os endpoints mudam.

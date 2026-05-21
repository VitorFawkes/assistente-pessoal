# Tarefas — UX inline com chips clicáveis

**Data:** 2026-05-20
**Status:** Aprovado, pronto pra implementação
**Escopo:** `frontend/` — lista de tarefas (dashboard + card)

## Problema

Hoje toda mudança numa tarefa (prazo, prioridade, owner, status, deletar) exige abrir um modal — mesmo trocas triviais como "empurra pra amanhã" ou "muda pra urgente". O usuário quer editar a maioria dos campos direto na lista, sem abrir o modal.

Estado atual:
- `task-row.tsx` — card clicável, único atalho inline é o checkbox de concluído
- `task-edit-modal.tsx` — modal completo com todos os campos
- Faltam no card: `meeting_recorded_at` (data da reunião), `prazo_text` (texto da IA), indicador de descrição

## Decisões aprovadas (durante brainstorm)

1. **Abordagem A** — chips clicáveis com popover, modal continua existindo (escolhido sobre edit-in-place e swipe).
2. **Save otimista** — clicou na opção → estado local atualiza → PATCH em paralelo → erro reverte + toast.
3. **Concluída fica no checkbox** — não vira opção do popover de status (mantém atalho de 1 toque).
4. **Owner com autocomplete** — lista vem do banco (owners já usados), com input livre no topo do popover. "vitor" sempre no topo como "eu".
5. **Desktop popover / mobile bottom sheet** — break em 640px.
6. **Título/descrição/evidência** continuam só no modal.
7. **Deletar** entra como última opção do popover de status, separada, com confirmação inline em 2 toques.
8. **Prazo sempre com data** — formato "label · DD/MM" (ex: "hoje · 20/05", "sexta · 22/05").

## Arquitetura de componentes

### Novos componentes (em `frontend/components/task-chips/`)

#### `popover-shell.tsx`
Wrapper genérico. Detecta viewport e renderiza popover ancorado (desktop) ou bottom sheet (mobile, `< 640px`). Esc/click-fora fecha. Foco preso enquanto aberto. Aceita `children` + `trigger`.

Props:
- `open: boolean`, `onOpenChange: (open: boolean) => void`
- `trigger: ReactNode` (o chip)
- `children: ReactNode` (conteúdo do popover)
- `ariaLabel: string` (ex: "Mudar prazo")

#### `prazo-chip.tsx`
Chip + popover de prazo. Sempre presente (mesmo sem prazo, mostra "+ prazo" tracejado).

Cores do chip:
- `vencida` → fundo `--urgent`, texto branco, prefixo "⚠ vencida · " + relativo se < 7d ("ontem", "há 3d") ou data ("há 12d · 08/05")
- `hoje` → fundo `--warm-bg`, texto `--warm`, peso 600, "hoje · DD/MM"
- `amanhã` → idem hoje, opacity 0.9, "amanhã · DD/MM"
- `futuro` → fundo `--accent`, texto `--muted-strong`, "{dia da semana} · DD/MM" se < 7d, senão "DD/MM"
- `vazio` → transparente, borda tracejada `--border`, texto `--muted`, "+ prazo"

Conteúdo do popover (2 colunas):
- Quick: hoje (DD/MM), amanhã (DD/MM), sexta (DD/MM), +1 semana (DD/MM)
- Divisor
- "📅 escolher data..." → abre `<input type="date">` inline
- "✕ remover prazo" → texto vermelho

Mudança limpa também `prazo_text`. Após salvar com data nova, `prazo_text` fica `null` (texto da IA não faz sentido depois de override manual).

#### `prioridade-chip.tsx`
Chip + popover de prioridade.

Renderização condicional do chip:
- `urgente` → fundo `--urgent`, texto branco, "⚡ urgente"
- `alta` → fundo `--warm-bg`, "⚡ alta"
- `media` → chip não renderiza (default — só faixa lateral)
- `baixa` → chip não renderiza

Quando `media`/`baixa`, o usuário precisa de outro affordance pra mudar a prioridade. Solução: a **faixa lateral colorida** vira clicável (não mostra chip "~ média" pra manter linha de chips limpa).

- Faixa visual continua 6px de largura.
- `<button>` invisível com `padding-left: 16px` estende área hit até o início do checkbox (touch-friendly).
- Hover (desktop): cursor pointer + glow leve (box-shadow interno) + tooltip "Prioridade: {nível} · clique pra mudar".
- Mobile: sem hover, área de toque 16px resolve. Discoverability via uso (Vitor é único usuário).
- `aria-label="Mudar prioridade ({nível atual})"`.

Popover (4 opções verticais):
- Swatch colorido + texto: urgente / alta / média / baixa

#### `owner-chip.tsx`
Chip + popover com autocomplete.

Cores do chip:
- `is_mine === true` → fundo `--calm-bg`, "👤 minha"
- `is_mine === false && owner !== "?"` → fundo `--warm-bg`, "→ {owner}"
- `owner === "?"` → fundo `--urgent-bg`, borda tracejada, "? definir responsável"

Popover:
- Input de texto livre no topo (placeholder "digite ou escolha…")
- Lista filtrada por input. Ordem: "vitor" (rotulado "eu") sempre primeiro, depois outros por frequência.
- Última opção: "? não definido" (seta `owner = "?"`)
- Enter no input cria/seleciona o texto digitado

Lista vem de `GET /api/owners` (ver seção API).

#### `status-chip.tsx`
Chip + popover de status. Inclui deletar.

Renderização condicional do chip de status na linha 1:
- `status === "aberta"` → chip não renderiza (default)
- `status === "em_andamento"` → "⏵ em andamento", fundo `--accent`, clicável → popover
- `status === "cancelada"` → "✕ cancelada", fundo `--muted` opacity, clicável → popover
- `status === "concluida"` → chip não renderiza (visual de done já é o checkbox + line-through)

**Affordance principal: kebab menu `⋮`** no canto direito do card, substituindo o chevron antigo. O chevron antigo carrega convenção universal de "navegar pra detalhe" — sobrecarregar com popover quebra mental model. Kebab é convenção universal de "mais ações".

- Click no kebab → popover de status + deletar (sempre disponível, independente do status atual)
- Click no card (fora de chips/check/kebab) → abre modal (mesma intenção do chevron antigo)
- Visual: `⋮` em `--muted`, hover `--foreground`, área hit 28×44px

Popover:
- ○ aberta
- ⏵ em andamento
- ✕ cancelada (cor `--urgent` mais clara, divisor antes)
- Divisor
- 🗑 deletar tarefa (cor `--urgent`, peso 600)

**Confirmação inline de deletar:** primeiro clique em "deletar" transforma a linha em "tem certeza? · deletar" com cor `--urgent` cheia. Segundo clique deleta. Clique fora ou outra ação reseta. Não usa `confirm()` do navegador.

#### `reuniao-chip.tsx`
Chip puramente decorativo + linkável (não tem popover).

- Texto: "🎙 reunião · {relativo}" (relativo: "hoje", "ontem", "há 2d", "há 1mês")
- Hover/active: vai pra `/reunioes/{meeting_id}`
- Não aparece se `meeting_id === null`

### Arquivos modificados

#### `components/task-row.tsx`
Novo layout (referência: `layout-v2.html` no preview):

```
┌─[faixa]─[check]─[corpo]──────────────────[kebab]──┐
│  6px*  44px   chips/título/chips           28px   │
└───────────────────────────────────────────────────┘
* faixa visual 6px; hit area 16px (clicável pra prioridade)

corpo:
  Linha 1 (chips): <PrioridadeChip> <OwnerChip> <StatusChip>
  Linha 2 (título): {titulo} {tem_descricao ? "•" : null}
  Linha 3 (chips): <PrazoChip> <ReuniaoChip>
  Linha 4 (opcional): "IA captou: '{prazo_text}'" se prazo_text ≠ texto do chip
```

Removido do card (vai pro modal):
- "criada em X" (`created_at`)

Mantido:
- Click no card (fora dos chips) abre o modal — mesmo padrão atual com `e.stopPropagation()` nos chips.
- Checkbox toggle `concluida`/`aberta` (mantém atalho).
- Visual de done (line-through, opacity 55%).
- Border destacada de vencida.

Estado local pra otimismo:
```ts
const [optimistic, setOptimistic] = useState<Partial<Tarefa>>({});
const tarefa = { ...tarefaProp, ...optimistic };
```

Helper `mutate(patch)` no `task-row.tsx`:
1. `setOptimistic(prev => ({ ...prev, ...patch }))`
2. `PATCH /api/tarefas/{id}` com `patch`
3. Sucesso → `router.refresh()` e limpa `optimistic` (refresh vai trazer estado novo)
4. Erro → reverte `optimistic`, toast com `error`

Esse `mutate` é passado pra cada chip via prop.

#### `components/task-edit-modal.tsx`
Simplificado. Mantém só:
- Título (input)
- Descrição (textarea)
- Evidência (read-only, novo — não tinha antes)
- Botão deletar (com confirmação)
- Footer: cancelar / salvar

Remove do modal:
- Prazo + quick prazo
- Prioridade
- Owner
- Status

Adiciona no rodapé do modal um link discreto pra `/reunioes/{meeting_id}` mostrando data da reunião e o trecho de evidência (read-only).

#### `lib/utils.ts`
Helpers novos:

```ts
// "hoje · 20/05", "sexta · 22/05", "vencida · ontem 19/05", "+ prazo"
export function formatPrazoComData(iso: string | null): {
  text: string;
  status: "vencida" | "hoje" | "amanha" | "futuro" | "sem_prazo";
};

// "hoje", "ontem", "há 2d", "há 1sem", "há 1mês"
export function formatRelativo(iso: string | null): string;
```

Mantém `formatPrazo` existente até a migração consumir o novo (deletar depois).

### API nova

#### `app/api/owners/route.ts`

`GET /api/owners` →
```json
{
  "owners": [
    { "name": "vitor", "is_me": true, "count": 42 },
    { "name": "Maria", "is_me": false, "count": 8 },
    { "name": "João", "is_me": false, "count": 3 }
  ]
}
```

SQL:
```sql
SELECT TRIM(owner) AS name, COUNT(*) AS count
FROM tarefas
WHERE owner IS NOT NULL AND owner <> '' AND owner <> '?'
GROUP BY TRIM(owner)
ORDER BY count DESC, name ASC;
```

Pós-processamento JS:
- `is_me = name.toLowerCase() === "vitor"`
- Ordena com `is_me` primeiro

Cache: response com header `Cache-Control: private, max-age=60`.

### API existente (sem mudança)

`PATCH /api/tarefas/[id]` já aceita campos parciais (`titulo`, `descricao`, `owner`, `prazo`, `prazo_text`, `prioridade`, `status`). Mantém.

`DELETE /api/tarefas/[id]` já existe. Mantém.

## Comportamento

### Otimismo + erros
- Estado local em `task-row.tsx` (não em context global — cada row gerencia seu próprio).
- Toast via `sonner` em erro. Mensagem genérica + retry button opcional (v2).
- `router.refresh()` no sucesso pra reconciliar.

### Mobile vs desktop
- `popover-shell.tsx` usa `window.matchMedia("(min-width: 640px)")` num hook `useIsDesktop()`.
- Desktop: Radix `Popover` ou implementação manual com `position: absolute` ancorado ao trigger via `getBoundingClientRect`.
- Mobile: `position: fixed; bottom: 0; left: 0; right: 0` + handle no topo + backdrop blur.

Decisão técnica:
- Desktop: **`@radix-ui/react-popover`** (a11y embutida, padrão Next/Tailwind).
- Mobile: **`vaul`** (drawer/bottom sheet polido, mesmo autor do `sonner`, ~3kb, drag com momentum e snap points). `popover-shell.tsx` detecta breakpoint e renderiza um ou outro.

### A11y
- Chip = `<button type="button" aria-haspopup="dialog" aria-expanded={open}>`
- Popover = `role="dialog"` + `aria-label`
- Focus trap dentro do popover
- Esc fecha, Tab navega opções, Enter seleciona
- `aria-live="polite"` no container do toast pra anunciar mudanças

### Conflito de clique
Hierarquia de área clicável dentro do card (cada uma com `stopPropagation`):
- Faixa lateral (16px hit) → abre popover de prioridade
- Checkbox (44px) → toggle concluída/aberta
- Chips no corpo → abrem seus popovers respectivos
- Kebab `⋮` (28px) → abre popover de status + deletar
- Resto do corpo (título, áreas vazias) → abre modal

Implementação: chips e botões usam `e.stopPropagation()` no `onClick`. Wrapper externo do card (`role="button"`) é o handler de "abrir modal".

### Casos de borda
- **Popover aberto + clicar em outro chip** → fecha o anterior, abre o novo (gerencia via `openChipId` no estado do row, ou `<RadioGroup>` de popovers).
- **PATCH falha por concorrência** → reverte otimismo, toast com mensagem do servidor.
- **Owner texto livre com espaços/case** → backend já guarda como o usuário digitou. `/api/owners` agrega case-insensitive.
- **Mudar `media`/`baixa` quando o chip não aparece** → faixa lateral clicável resolve.
- **Deletar com confirmação aberto e usuário fecha o popover** → cancela a confirmação.

## Plano de implementação (ordem)

Cada item é mergeável independente.

1. **Utils + sonner setup** — `formatPrazoComData`, `formatRelativo`, instalar `sonner`, montar `<Toaster />` no `app/layout.tsx`.
2. **`popover-shell.tsx`** — abstração desktop/mobile com Radix Popover + custom sheet (ou vaul).
3. **`/api/owners`** — endpoint + cache.
4. **`reuniao-chip.tsx`** — mais simples, sem popover. Bom pra validar o estilo dos chips em isolamento.
5. **`prazo-chip.tsx`** — primeira mudança visível ao usuário, valida o padrão de popover + otimismo.
6. **`prioridade-chip.tsx`** — inclui faixa lateral clicável.
7. **`owner-chip.tsx`** — autocomplete + integração com `/api/owners`.
8. **`status-chip.tsx`** — inclui deletar com confirmação inline.
9. **Refatorar `task-row.tsx`** — consumir os 5 chips, novo layout, otimismo.
10. **Simplificar `task-edit-modal.tsx`** — remove campos que viraram inline.
11. **Limpeza** — deleta `formatPrazo` antigo se ninguém mais consome.

Cada PR/commit pode ser pequeno. Recomendo commit por item (1-11).

## Decisões resolvidas

Todas as decisões pendentes foram tomadas (delegadas pelo Vitor com "tome a melhor decisão"):

1. **Toast: `sonner`** — autor referência em UX de toast (Emil Kowalski), ~6kb, swipe-to-dismiss, queue automático, a11y nativa.
2. **Bottom sheet: `vaul`** — mesmo autor do sonner, ~3kb, drag com momentum e snap points. Diferença de polish vs CSS custom é notável e o custo é minúsculo.
3. **Faixa lateral clicável** (sem chip "~ média"). Mantém linha de chips limpa. Hover + tooltip resolve discoverability pra usuário único.
4. **Kebab `⋮` substitui o chevron** pra abrir popover de status/deletar. Preserva mental model do chevron (= navegar) e usa convenção universal do kebab (= mais ações).

Dependências novas a instalar: `sonner`, `vaul`, `@radix-ui/react-popover`.

## Fora de escopo

- Bulk actions (selecionar várias tarefas)
- Undo após delete (toast com "desfazer")
- Criar tarefa manual (hoje só via IA)
- Reordenação manual / drag-and-drop
- Filtros novos (data/created/urgente continuam como estão)
- Edit-in-place do título (modal segue)

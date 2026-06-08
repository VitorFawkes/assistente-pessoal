# Captura sem fricção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir capturar uma tarefa em segundos por texto (linguagem natural) ou voz no app, com o GPT auto-estruturando-a na hora (título preservado + chips de quem/quando/prioridade/área ajustáveis).

**Architecture:** Caminho 1 (cérebro síncrono no Next.js). Uma função pura+rede `parseCapture` (`lib/capture.ts`) chama o GPT via `fetch`; a rota `POST /api/capturar` chama `parseCapture` → `tarefasFor(userId).criar(draft)` (helper compartilhado com o `POST /api/tarefas` manual, que devolve a `Tarefa` serializada completa). UI: um compositor no topo da home com chips editáveis pós-criação. n8n/reuniões ficam intocados.

**Tech Stack:** Next.js 16 (App Router, Server Components + Route Handlers), TypeScript, `pg` (SQL cru via `lib/db.ts`/`lib/queries.ts`, RLS multi-tenant via `withTenant`), Tailwind 4, `bun` (runtime + `bun test`). GPT via `fetch` na OpenAI API (sem dep nova). Spec: [2026-06-08-captura-sem-friccao-design.md](../specs/2026-06-08-captura-sem-friccao-design.md).

---

## Realidades do repo (leia antes de começar)

1. **Teste**: o único teste é `frontend/lib/detect-cuts.test.ts`, em `bun:test` (`import { test, expect, describe } from "bun:test"`), rodado com `bun test` dentro de `frontend/`. **Não há** harness de teste de componente React nem de rota. ⇒ TDD real só pra **lógica pura** (parsing, `precisa_revisao`). Rotas/UI: verificação manual (rodar o app) ou pós-deploy.
2. **DB inalcançável localmente**: `DATABASE_URL` aponta pra `n8n_assistente-pessoal-db` (host interno do swarm). Migrations e queries de produção rodam via SSH + `docker exec` (padrão em `~/.claude/.../memory/assistente-db-access.md`). Código que depende do DB é verificado **no ambiente deployado** (deploy = GHCR + GitHub Actions; `docker service update --force` no swarm).
3. **Multi-tenant**: todo INSERT carrega `user_id` explícito; leituras rodam dentro de `withTenant(userId, …)` (RLS filtra). Vitor = `7740e829-9462-416b-81a1-b787e23ba9b2`.
4. **Migrations**: arquivos `db/000N_*.sql` aplicados manualmente. O `0010` (frentes, `tarefa_pessoas`, `pessoas_raw`, `area_raw`, triggers `resolve_tarefa_pessoas`/`resolve_tarefa_area`) e o `0008` (`acao`) **já estão aplicados**.
5. **DRY/YAGNI**: sem libs novas. Chips usam popover mínimo caseiro (não radix/vaul — isso fica pro spec 2026-05-20). `fetch` em vez do SDK da OpenAI.

Comando-base pra rodar SQL em produção (usado em vários passos abaixo):

```bash
# rodar a partir da raiz do repo (/Users/vitorgambetti/AssistentePessoal)
set -a && . ./.env && set +a
CID=$(sshpass -p "$VPS_ROOT_PASSWORD" ssh -o StrictHostKeyChecking=accept-new "$VPS_SSH_USER@$VPS_SSH_HOST" \
  "docker ps --format '{{.Names}}' | grep assistente-pessoal-db")
# uso: PSQL <<'SQL' ... SQL   |  ou:  cat arquivo.sql | PSQL_PIPE
```

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `db/0011_captura.sql` | Coluna `precisa_revisao` + índice parcial | Criar |
| `frontend/lib/queries.ts` | Type `Tarefa` (+`precisa_revisao`); `TAREFA_SELECT` extraído; `tarefasFor().criar()` | Modificar |
| `frontend/app/api/tarefas/route.ts` | POST manual passa a chamar `criar()` | Modificar |
| `frontend/lib/capture.ts` | `normalizeDraft` (puro) + `precisaRevisao` (puro) + `parseCapture` (fetch GPT) | Criar |
| `frontend/lib/capture.test.ts` | Testes `bun:test` da lógica pura | Criar |
| `frontend/app/api/capturar/route.ts` | `POST /api/capturar` (texto/áudio → parseCapture → criar) | Criar |
| `frontend/app/api/owners/route.ts` | `GET /api/owners` (autocomplete de responsável) | Criar |
| `frontend/components/task-chips/popover.tsx` | Popover mínimo caseiro (sem dep) | Criar |
| `frontend/components/task-chips/quando-chip.tsx` | Chip de prazo | Criar |
| `frontend/components/task-chips/pra-quem-chip.tsx` | Chip owner+acao | Criar |
| `frontend/components/task-chips/prioridade-chip.tsx` | Chip prioridade | Criar |
| `frontend/components/task-chips/area-chip.tsx` | Chip área (frentes) | Criar |
| `frontend/components/capture-composer.tsx` | A barra de captura + chips + voz | Criar |
| `frontend/components/tasks-dashboard.tsx` | Monta o compositor no topo; mantém "abrir tudo" | Modificar |
| `frontend/components/task-row.tsx` | Marcador "revisar" no card | Modificar |

---

## Task 1: Migration — coluna `precisa_revisao`

**Files:**
- Create: `db/0011_captura.sql`
- Modify: `frontend/lib/queries.ts:43-64` (type `Tarefa`)

- [ ] **Step 1: Criar a migration**

Criar `db/0011_captura.sql`:

```sql
-- 0011_captura.sql — captura sem fricção
-- Constrói sobre 0010 (frentes/tarefa_pessoas/pessoas_raw/area_raw) já aplicado.

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS precisa_revisao boolean NOT NULL DEFAULT false;

-- filtro futuro "só revisar" (parcial, barato)
CREATE INDEX IF NOT EXISTS idx_tarefas_revisao ON tarefas (user_id) WHERE precisa_revisao;
```

- [ ] **Step 2: Aplicar em produção**

```bash
set -a && . ./.env && set +a
CID=$(sshpass -p "$VPS_ROOT_PASSWORD" ssh -o StrictHostKeyChecking=accept-new "$VPS_SSH_USER@$VPS_SSH_HOST" \
  "docker ps --format '{{.Names}}' | grep assistente-pessoal-db")
cat db/0011_captura.sql | sshpass -p "$VPS_ROOT_PASSWORD" ssh "$VPS_SSH_USER@$VPS_SSH_HOST" \
  "docker exec -i $CID sh -c 'PGPASSWORD=\$POSTGRES_PASSWORD psql -U \$POSTGRES_USER -d \$POSTGRES_DB -v ON_ERROR_STOP=1'"
```
Expected: `ALTER TABLE` + `CREATE INDEX` (ou `NOTICE ... already exists` se reaplicado).

- [ ] **Step 3: Verificar a coluna**

```bash
sshpass -p "$VPS_ROOT_PASSWORD" ssh "$VPS_SSH_USER@$VPS_SSH_HOST" \
  "docker exec -i $CID sh -c 'PGPASSWORD=\$POSTGRES_PASSWORD psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"\\d tarefas\"'" | grep precisa_revisao
```
Expected: linha `precisa_revisao | boolean | not null default false`.

- [ ] **Step 4: Refletir no type `Tarefa`**

Em `frontend/lib/queries.ts`, no type `Tarefa` (após `cancelada_em`):

```ts
  concluida_em: string | null;
  cancelada_em: string | null;
  precisa_revisao: boolean;
};
```

- [ ] **Step 5: Commit**

```bash
git add db/0011_captura.sql frontend/lib/queries.ts
git commit -m "feat(db): coluna precisa_revisao para captura sem fricção"
```

---

## Task 2: Refactor — `TAREFA_SELECT` + `tarefasFor().criar()`

Extrai o SELECT de tarefa serializada (hoje duplicado em `recentes`/`byMeeting`) e cria o helper de criação compartilhado que devolve a `Tarefa` completa.

**Files:**
- Modify: `frontend/lib/queries.ts` (add `TAREFA_SELECT`, add `criar`, reuse no `recentes`)

- [ ] **Step 1: Extrair o fragmento de SELECT**

Em `frontend/lib/queries.ts`, logo antes de `export const meetingsFor`, adicionar:

```ts
// SELECT canônico de uma tarefa serializada (frente + pessoas agregadas).
// Use com um WHERE depois. Mantém o shape idêntico em recentes/criar.
const TAREFA_SELECT = `
  SELECT t.*,
         to_char(m.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS meeting_recorded_at,
         m.summary AS meeting_summary,
         f.nome AS frente,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'principal', tp.principal)
                            ORDER BY tp.principal DESC, p.nome)
           FROM tarefa_pessoas tp JOIN pessoas p ON p.id = tp.pessoa_id
           WHERE tp.tarefa_id = t.id
         ), '[]'::jsonb) AS pessoas
    FROM tarefas t
    LEFT JOIN meetings m ON m.id = t.meeting_id
    LEFT JOIN frentes f ON f.id = t.frente_id`;
```

- [ ] **Step 2: `recentes` reusa o fragmento**

Substituir o corpo do SELECT em `recentes` (linhas ~229-245) por:

```ts
      const r = await db.query<
        Tarefa & { meeting_recorded_at: string | null; meeting_summary: string | null }
      >(
        `${TAREFA_SELECT}
          ORDER BY (t.status NOT IN ('aberta','em_andamento')),
                   (t.acao = 'aguardar'),
                   (t.prazo IS NULL), t.prazo ASC, t.created_at DESC
          LIMIT 300`,
      );
      return r.rows;
```

- [ ] **Step 3: Adicionar o type do draft e o método `criar`**

No topo de `queries.ts` (após `export type TarefaPessoa`):

```ts
export type TarefaDraft = {
  titulo: string;
  descricao?: string | null;
  owner?: string;                // default "vitor"
  acao?: Acao;                   // default "executar"
  prazo?: string | null;         // ISO ou null
  prazo_text?: string | null;
  prioridade?: Tarefa["prioridade"]; // default "media"
  // pessoas: ou nomes crus (captura → pessoas_raw + trigger) ou objetos (modal manual)
  pessoas?: string[] | { nome: string; principal?: boolean }[];
  // área: ou frente_id explícito (modal) ou nome cru (captura → area_raw + trigger)
  frente_id?: string | null;
  area_raw?: string | null;
  precisa_revisao?: boolean;     // default false
};

export type CriarMeta = {
  origem: "manual" | "captura_texto" | "captura_voz";
  raw?: string;                  // texto cru capturado (auditoria)
  confidence?: "high" | "medium" | "low";
};
```

Dentro de `tarefasFor(userId)`, adicionar o método `criar` (depois de `recentes`):

```ts
  /** Cria uma tarefa (manual ou captura) e devolve a Tarefa COMPLETA serializada.
   *  meeting_id é sempre NULL aqui (tarefa não vem de reunião). */
  criar: (draft: TarefaDraft, meta: CriarMeta) =>
    withTenant(userId, async (db) => {
      const pessoasRaw = Array.isArray(draft.pessoas) && typeof draft.pessoas[0] === "string"
        ? JSON.stringify(draft.pessoas)
        : null;

      const ins = await db.query<{ id: string }>(
        `INSERT INTO tarefas
           (user_id, titulo, descricao, owner, acao, prazo, prazo_text, prioridade,
            frente_id, area_raw, pessoas_raw, precisa_revisao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          userId,
          draft.titulo.trim(),
          draft.descricao?.trim() || null,
          (draft.owner ?? "vitor").trim() || "vitor",
          draft.acao ?? "executar",
          draft.prazo ?? null,
          draft.prazo_text?.trim() || null,
          draft.prioridade ?? "media",
          draft.frente_id ?? null,
          draft.area_raw?.trim() || null,
          pessoasRaw,
          draft.precisa_revisao ?? false,
        ],
      );
      const id = ins.rows[0].id;

      await db.query(
        "INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,'criada',$2)",
        [id, JSON.stringify({ origem: meta.origem, raw: meta.raw ?? null, confidence: meta.confidence ?? null })],
      );

      // Caminho manual: pessoas como objetos {nome, principal} (com flag principal explícita).
      if (Array.isArray(draft.pessoas) && draft.pessoas.length > 0 && typeof draft.pessoas[0] !== "string") {
        for (const p of draft.pessoas as { nome: string; principal?: boolean }[]) {
          const nome = (p.nome || "").trim();
          if (!nome || nome === "?") continue;
          const pr = await db.query<{ id: string }>(
            `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
             ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
            [userId, nome],
          );
          await db.query(
            `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,$3)
             ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal`,
            [id, pr.rows[0].id, !!p.principal],
          );
        }
      }
      // (caminho captura: pessoas_raw acima → trigger resolve_tarefa_pessoas resolve sozinho)

      const out = await db.query<Tarefa & { meeting_recorded_at: string | null; meeting_summary: string | null }>(
        `${TAREFA_SELECT} WHERE t.id = $1`,
        [id],
      );
      return out.rows[0];
    }),
```

> Nota: `pessoas_raw` e `area_raw` são colunas do `0010`; os triggers `resolve_tarefa_pessoas` (AFTER INSERT) e `resolve_tarefa_area` (BEFORE INSERT) já existem e resolvem `tarefa_pessoas`/`frente_id`/`frente_proposta`.

- [ ] **Step 4: Migrar `POST /api/tarefas` pra usar `criar`**

Substituir o corpo do `try` em `frontend/app/api/tarefas/route.ts:49-95` (de `const created = await withTenant(...)` até `return NextResponse.json(created, ...)`) por:

```ts
  try {
    const { tarefasFor } = await import("@/lib/queries");
    const created = await tarefasFor(user.id).criar(
      {
        titulo,
        descricao: body.descricao ?? null,
        owner,
        acao,
        prazo: body.prazo ?? null,
        prazo_text: body.prazo_text ?? null,
        prioridade,
        frente_id: body.frente_id ?? null,
        pessoas: Array.isArray(body.pessoas) ? body.pessoas : undefined,
      },
      { origem: "manual" },
    );
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
```

Remover os imports agora não usados (`withTenant`, `withAuth` continua) de `route.ts` se o `withTenant` não for mais referenciado. (`withAuth` permanece.)

- [ ] **Step 5: Type-check**

Run (em `frontend/`): `bunx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Verificação manual (pós-deploy ou via DB tunnel)**

Criar uma tarefa pelo modal "Nova tarefa" existente; confirmar que (a) aparece na lista com pessoas/frente corretas, (b) o evento `criada` tem `payload.origem='manual'`. Query de conferência:
```sql
SELECT t.id, t.titulo, e.payload FROM tarefas t
JOIN tarefa_eventos e ON e.tarefa_id=t.id AND e.evento='criada'
WHERE t.user_id='7740e829-9462-416b-81a1-b787e23ba9b2' ORDER BY t.created_at DESC LIMIT 1;
```

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/queries.ts frontend/app/api/tarefas/route.ts
git commit -m "refactor(tarefas): tarefasFor().criar() compartilhado + TAREFA_SELECT"
```

---

## Task 3: `lib/capture.ts` — lógica pura (TDD)

Separa o que é testável sem rede: `normalizeDraft` (coage o JSON do GPT em `CaptureDraft` com defaults) e `precisaRevisao`.

**Files:**
- Create: `frontend/lib/capture.ts`
- Test: `frontend/lib/capture.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `frontend/lib/capture.test.ts`:

```ts
import { test, expect, describe } from "bun:test";
import { normalizeDraft, precisaRevisao, type RawDraft } from "./capture";

describe("normalizeDraft", () => {
  test("aplica defaults quando o GPT omite campos", () => {
    const d = normalizeDraft({ titulo: "ligar pro contador" } as RawDraft);
    expect(d.titulo).toBe("ligar pro contador");
    expect(d.owner).toBe("vitor");
    expect(d.acao).toBe("executar");
    expect(d.prioridade).toBe("media");
    expect(d.prazo).toBeNull();
    expect(d.pessoas).toEqual([]);
    expect(d.confidence).toBe("low"); // sem confidence explícito → low
  });

  test("coage valores inválidos pros defaults", () => {
    const d = normalizeDraft({ titulo: "x", acao: "delegar", prioridade: "altíssima" } as unknown as RawDraft);
    expect(d.acao).toBe("executar");
    expect(d.prioridade).toBe("media");
  });

  test("preserva campos válidos", () => {
    const d = normalizeDraft({
      titulo: "cobrar relatório", owner: "Estela", acao: "cobrar",
      prazo: "2026-06-12T23:59:00Z", prazo_text: "até quinta",
      prioridade: "alta", area_raw: "Vendas/SDR", pessoas: ["Estela"],
      confidence: "high", confidence_rationale: "delegação clara",
    });
    expect(d.owner).toBe("Estela");
    expect(d.acao).toBe("cobrar");
    expect(d.pessoas).toEqual(["Estela"]);
    expect(d.confidence).toBe("high");
  });

  test("titulo vazio vira string vazia (rota decide o que fazer)", () => {
    const d = normalizeDraft({} as RawDraft);
    expect(d.titulo).toBe("");
  });
});

describe("precisaRevisao", () => {
  test("confidence != high → true", () => {
    expect(precisaRevisao({ confidence: "low", prazo: null, prazo_text: null } as any)).toBe(true);
    expect(precisaRevisao({ confidence: "medium", prazo: "2026-06-12", prazo_text: "quinta" } as any)).toBe(true);
  });
  test("confidence high sem pendência → false", () => {
    expect(precisaRevisao({ confidence: "high", prazo: "2026-06-12", prazo_text: "quinta" } as any)).toBe(false);
    expect(precisaRevisao({ confidence: "high", prazo: null, prazo_text: null } as any)).toBe(false);
  });
  test("high mas tinha texto temporal e prazo não resolveu → true", () => {
    expect(precisaRevisao({ confidence: "high", prazo: null, prazo_text: "semana que vem" } as any)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `bun test lib/capture.test.ts`
Expected: FAIL — `Cannot find module './capture'`.

- [ ] **Step 3: Implementar a lógica pura**

Criar `frontend/lib/capture.ts`:

```ts
import type { Acao } from "./queries";

const PRIORIDADES = ["baixa", "media", "alta", "urgente"] as const;
const ACOES = ["executar", "cobrar", "aguardar"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;

export type Confidence = (typeof CONFIDENCES)[number];

// O que o GPT devolve (cru, não confiável).
export type RawDraft = {
  titulo?: string;
  descricao?: string | null;
  owner?: string;
  acao?: string;
  prazo?: string | null;
  prazo_text?: string | null;
  prioridade?: string;
  area_raw?: string | null;
  pessoas?: string[];
  confidence?: string;
  confidence_rationale?: string;
};

export type CaptureDraft = {
  titulo: string;
  descricao: string | null;
  owner: string;
  acao: Acao;
  prazo: string | null;
  prazo_text: string | null;
  prioridade: (typeof PRIORIDADES)[number];
  area_raw: string | null;
  pessoas: string[];
  confidence: Confidence;
  confidence_rationale: string;
};

function oneOf<T extends readonly string[]>(list: T, v: unknown, dflt: T[number]): T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : dflt;
}

export function normalizeDraft(raw: RawDraft): CaptureDraft {
  return {
    titulo: (raw.titulo ?? "").trim(),
    descricao: raw.descricao?.trim() || null,
    owner: (raw.owner ?? "vitor").trim() || "vitor",
    acao: oneOf(ACOES, raw.acao, "executar"),
    prazo: raw.prazo ?? null,
    prazo_text: raw.prazo_text?.trim() || null,
    prioridade: oneOf(PRIORIDADES, raw.prioridade, "media"),
    area_raw: raw.area_raw?.trim() || null,
    pessoas: Array.isArray(raw.pessoas) ? raw.pessoas.map((p) => String(p).trim()).filter(Boolean) : [],
    confidence: oneOf(CONFIDENCES, raw.confidence, "low"),
    confidence_rationale: (raw.confidence_rationale ?? "").trim(),
  };
}

export function precisaRevisao(d: Pick<CaptureDraft, "confidence" | "prazo" | "prazo_text">): boolean {
  if (d.confidence !== "high") return true;
  if (d.prazo_text && !d.prazo) return true; // disse "semana que vem" mas não resolveu data
  return false;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test lib/capture.test.ts`
Expected: PASS (todos os testes).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/capture.ts frontend/lib/capture.test.ts
git commit -m "feat(capture): lógica pura normalizeDraft + precisaRevisao (TDD)"
```

---

## Task 4: `parseCapture` — chamada ao GPT

**Files:**
- Modify: `frontend/lib/capture.ts` (add `parseCapture`, `CaptureCtx`, prompt)

- [ ] **Step 1: Adicionar tipos de contexto e o prompt**

No topo de `frontend/lib/capture.ts` (após os types):

```ts
export type CaptureCtx = {
  hoje: string;                       // "2026-06-08"
  tz: string;                         // "America/Sao_Paulo"
  frentes: { nome: string }[];
  owners: { name: string; is_me: boolean }[];
};

const CAPTURE_MODEL = process.env.CAPTURE_MODEL || "gpt-5.1";

const SYSTEM_PROMPT = `Você converte UMA frase solta do Vitor em UMA tarefa estruturada (JSON).

REGRAS:
- Extraia SÓ a tarefa principal. Se houver duas coisas, escolha a mais importante e ignore o resto.
- PRESERVE as palavras do Vitor no "titulo". NÃO parafraseie, não floreie. Tire data/pessoa/prioridade de DENTRO do título (elas viram campos), deixando o título enxuto. Ex.: "ligar pro contador sexta de manhã" → titulo "ligar pro contador" (NUNCA "Realizar contato telefônico com o contador").
- "acao": "executar" se o próprio Vitor faz (ou owner=vitor); "cobrar" se outra pessoa faz e o Vitor precisa acompanhar/cobrar; "aguardar" se outra pessoa faz sozinha e o Vitor não precisa cobrar. Na dúvida em delegação, use "cobrar".
- "owner": "vitor" se é o Vitor que faz; o nome da pessoa se for dela; "?" se mencionou alguém sem nome.
- "prazo": resolva expressões em pt-BR relativas a HOJE (no fuso informado) pra ISO 8601 com hora 23:59 local; null se não houver prazo. "prazo_text": o texto literal dito ("sexta de manhã", "semana que vem").
- "prioridade": baixa/media/alta/urgente pelo tom ("hoje/agora/asap"→urgente; "amanhã/antes da call"→alta; default media; "talvez/algum dia"→baixa).
- "area_raw": escolha UM nome da lista de áreas fornecida se encaixar; senão proponha um nome curto novo; null se nada se aplica.
- "pessoas": nomes citados envolvidos na tarefa (sem "vitor").
- "confidence": "high" só se título, owner e prazo estão claros; senão "medium"/"low". "confidence_rationale": 1 linha.

Responda APENAS com JSON: {titulo, descricao, owner, acao, prazo, prazo_text, prioridade, area_raw, pessoas, confidence, confidence_rationale}.`;
```

- [ ] **Step 2: Implementar `parseCapture`**

No fim de `frontend/lib/capture.ts`:

```ts
export async function parseCapture(raw: string, ctx: CaptureCtx): Promise<CaptureDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente no ambiente");

  const userPayload = {
    texto: raw,
    hoje: ctx.hoje,
    tz: ctx.tz,
    areas: ctx.frentes.map((f) => f.nome),
    pessoas_conhecidas: ctx.owners.map((o) => o.name),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: CAPTURE_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI: resposta sem conteúdo");
  return normalizeDraft(JSON.parse(content) as RawDraft);
}
```

- [ ] **Step 3: Type-check**

Run (em `frontend/`): `bunx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Protótipo de latência/qualidade (gate)**

Criar um script temporário `frontend/scripts/proto-capture.ts` que chama `parseCapture` com 5 exemplos pt-BR e mede tempo, rodando com `OPENAI_API_KEY` exportada:

```ts
import { parseCapture } from "../lib/capture";
const ctx = { hoje: "2026-06-08", tz: "America/Sao_Paulo",
  frentes: [{ nome: "Marketing" }, { nome: "Vendas/SDR" }, { nome: "Weddings" }],
  owners: [{ name: "vitor", is_me: true }, { name: "Estela", is_me: false }] };
const casos = [
  "ligar pro contador sexta de manhã",
  "cobrar o relatório da Estela até quinta",
  "comprar presente algum dia",
  "urgente responder o e-mail do investidor hoje",
  "ver com a Estela a landing de weddings semana que vem",
];
for (const c of casos) {
  const t0 = Date.now();
  const d = await parseCapture(c, ctx);
  console.log(`${Date.now() - t0}ms  «${c}» →`, JSON.stringify(d));
}
```
Run: `OPENAI_API_KEY=… bun run scripts/proto-capture.ts`
Avaliar: latência < ~2s e campos plausíveis. Se latência ruim, trocar `CAPTURE_MODEL` (env) por um tier mais rápido e repetir. Deletar o script depois.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/capture.ts
git commit -m "feat(capture): parseCapture chamando GPT via fetch"
```

---

## Task 5: `POST /api/capturar`

**Files:**
- Create: `frontend/app/api/capturar/route.ts`

- [ ] **Step 1: Implementar a rota (texto + áudio + fallback)**

Criar `frontend/app/api/capturar/route.ts`:

```ts
import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { frentesFor, tarefasFor } from "@/lib/queries";
import { parseCapture, precisaRevisao, type CaptureDraft } from "@/lib/capture";
import { ownersFor } from "@/lib/owners";

export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";

async function transcrever(audio: File): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente");
  const form = new FormData();
  form.append("file", audio, audio.name || "captura.webm");
  form.append("model", process.env.TRANSCRIBE_MODEL || "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`transcrição ${res.status}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export const POST = withAuth(async (user, req) => {
  const r = req as NextRequest;
  const contentType = r.headers.get("content-type") || "";

  let texto = "";
  let origem: "captura_texto" | "captura_voz" = "captura_texto";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await r.formData();
      const audio = form.get("audio");
      if (!(audio instanceof File)) {
        return NextResponse.json({ error: "áudio ausente" }, { status: 400 });
      }
      texto = await transcrever(audio);
      origem = "captura_voz";
    } else {
      const body = (await r.json()) as { texto?: string };
      texto = (body.texto ?? "").trim();
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "entrada inválida" }, { status: 400 });
  }

  if (!texto) return NextResponse.json({ error: "nada pra capturar" }, { status: 400 });

  // Estrutura via GPT; se falhar, salva cru (captura nunca falha).
  let draft: CaptureDraft;
  let confidence: CaptureDraft["confidence"] | undefined;
  try {
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
    const [frentes, owners] = await Promise.all([
      frentesFor(user.id).list(),
      ownersFor(user.id).list(),
    ]);
    draft = await parseCapture(texto, {
      hoje, tz: TZ,
      frentes: frentes.map((f) => ({ nome: f.nome })),
      owners: owners.map((o) => ({ name: o.name, is_me: o.is_me })),
    });
    confidence = draft.confidence;
  } catch (err) {
    console.error("[capturar] parseCapture falhou, salvando cru:", err);
    draft = {
      titulo: texto, descricao: null, owner: "vitor", acao: "executar",
      prazo: null, prazo_text: null, prioridade: "media", area_raw: null,
      pessoas: [], confidence: "low", confidence_rationale: "fallback: IA indisponível",
    };
  }

  const tarefa = await tarefasFor(user.id).criar(
    {
      titulo: draft.titulo || texto,
      descricao: draft.descricao,
      owner: draft.owner,
      acao: draft.acao,
      prazo: draft.prazo,
      prazo_text: draft.prazo_text,
      prioridade: draft.prioridade,
      area_raw: draft.area_raw,
      pessoas: draft.pessoas, // string[] → pessoas_raw → trigger
      precisa_revisao: precisaRevisao(draft),
    },
    { origem, raw: texto, confidence },
  );

  // custo (best-effort, não bloqueia)
  void user; // usage_events opcional — ver nota
  return NextResponse.json(tarefa, { status: 201 });
});
```

> Nota custo: registrar em `usage_events` é opcional pro MVP. Se quiser, adicionar dentro de um `withTenant` um INSERT `(user_id, event_type, units, cost_usd)` com `event_type='captura'`. Deferido por padrão.

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: erro só em `@/lib/owners` (criado na Task 6). Crie a Task 6 antes de fechar o type-check, ou stub temporário.

- [ ] **Step 3: Commit** (junto com Task 6 se preferir)

```bash
git add frontend/app/api/capturar/route.ts
git commit -m "feat(api): POST /api/capturar (texto+voz, auto-estrutura, fallback cru)"
```

---

## Task 6: `GET /api/owners` + `ownersFor`

**Files:**
- Create: `frontend/lib/owners.ts`
- Create: `frontend/app/api/owners/route.ts`

- [ ] **Step 1: Helper de query**

Criar `frontend/lib/owners.ts`:

```ts
import { withTenant } from "./db";

export type OwnerInfo = { name: string; is_me: boolean; frequency: number };

export const ownersFor = (userId: string) => ({
  list: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<{ name: string; frequency: number }>(
        `SELECT TRIM(owner) AS name, COUNT(*)::int AS frequency
           FROM tarefas
          WHERE owner IS NOT NULL AND TRIM(owner) <> '' AND owner <> '?'
          GROUP BY TRIM(owner)
          ORDER BY frequency DESC, name ASC
          LIMIT 30`,
      );
      const owners: OwnerInfo[] = r.rows.map((o) => ({
        name: o.name,
        is_me: o.name.toLowerCase() === "vitor",
        frequency: o.frequency,
      }));
      // garante "vitor" presente e no topo
      if (!owners.some((o) => o.is_me)) owners.unshift({ name: "vitor", is_me: true, frequency: 0 });
      owners.sort((a, b) => Number(b.is_me) - Number(a.is_me) || b.frequency - a.frequency);
      return owners;
    }),
});
```

- [ ] **Step 2: Rota**

Criar `frontend/app/api/owners/route.ts`:

```ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { ownersFor } from "@/lib/owners";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (user) => {
  const owners = await ownersFor(user.id).list();
  return NextResponse.json(
    { owners },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
});
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: sem erros (resolve o import da Task 5).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/owners.ts frontend/app/api/owners/route.ts
git commit -m "feat(api): GET /api/owners para autocomplete de responsável"
```

---

## Task 7: Popover mínimo + chips

Sem dep nova: popover caseiro (div absoluta + click-fora). Verificação é manual (rodar o app) — o repo não testa componentes.

**Files:**
- Create: `frontend/components/task-chips/popover.tsx`, `quando-chip.tsx`, `pra-quem-chip.tsx`, `prioridade-chip.tsx`, `area-chip.tsx`

- [ ] **Step 1: Popover base**

Criar `frontend/components/task-chips/popover.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Popover({ trigger, children, ariaLabel }: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        {trigger(open)}
      </button>
      {open && (
        <div role="dialog" aria-label={ariaLabel}
          className={cn("absolute z-50 mt-1 min-w-[180px] rounded-xl border border-[color:var(--border)]",
            "bg-[color:var(--card)] shadow-xl p-1.5")}
          onClick={(e) => e.stopPropagation()}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `quando-chip` (prazo)**

Criar `frontend/components/task-chips/quando-chip.tsx`:

```tsx
"use client";
import { CalendarClock } from "lucide-react";
import { Popover } from "./popover";
import { cn } from "@/lib/utils";

function nextWeekday(target: number): Date {
  const d = new Date(); const delta = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta); return d;
}
function isoEndOfDay(d: Date): string {
  const x = new Date(d); x.setHours(23, 59, 0, 0); return x.toISOString();
}
function label(iso: string | null): string {
  if (!iso) return "+ quando";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function QuandoChip({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const quick: { k: string; label: string; date: () => Date }[] = [
    { k: "hoje", label: "Hoje", date: () => new Date() },
    { k: "amanha", label: "Amanhã", date: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; } },
    { k: "sexta", label: "Sexta", date: () => nextWeekday(5) },
    { k: "prox", label: "+1 semana", date: () => { const d = new Date(); d.setDate(d.getDate() + 7); return d; } },
  ];
  return (
    <Popover ariaLabel="Mudar prazo"
      trigger={() => (
        <span className={cn("inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full",
          value ? "bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
                : "border border-dashed border-[color:var(--border)] text-[color:var(--muted)]")}>
          <CalendarClock size={11} /> {label(value)}
        </span>
      )}>
      {(close) => (
        <div className="flex flex-col">
          {quick.map((q) => (
            <button key={q.k} type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)]"
              onClick={() => { onChange(isoEndOfDay(q.date())); close(); }}>{q.label}</button>
          ))}
          <input type="date" className="mt-1 px-2 py-1 text-sm rounded border border-[color:var(--border)] bg-transparent"
            onChange={(e) => { const v = e.target.value; if (v) { const [y, m, d] = v.split("-").map(Number); onChange(isoEndOfDay(new Date(y, m - 1, d))); close(); } }} />
          {value && (
            <button type="button" className="text-left text-sm px-2 py-1.5 rounded text-[color:var(--urgent)] hover:bg-[color:var(--accent)]"
              onClick={() => { onChange(null); close(); }}>remover prazo</button>
          )}
        </div>
      )}
    </Popover>
  );
}
```

- [ ] **Step 3: `prioridade-chip`**

Criar `frontend/components/task-chips/prioridade-chip.tsx`:

```tsx
"use client";
import { Flame } from "lucide-react";
import { Popover } from "./popover";
import { cn, type Prioridade } from "@/lib/utils";

const OPTS: Prioridade[] = ["baixa", "media", "alta", "urgente"];

export function PrioridadeChip({ value, onChange }: { value: Prioridade; onChange: (p: Prioridade) => void }) {
  return (
    <Popover ariaLabel="Mudar prioridade"
      trigger={() => (
        <span className={cn("inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full",
          value === "urgente" ? "bg-[color:var(--urgent)] text-white"
          : value === "alta" ? "bg-[color:var(--warm-bg)] text-[color:var(--warm)]"
          : "bg-[color:var(--accent)] text-[color:var(--muted-strong)]")}>
          <Flame size={11} /> {value}
        </span>
      )}>
      {(close) => (
        <div className="flex flex-col">
          {OPTS.map((p) => (
            <button key={p} type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)]"
              onClick={() => { onChange(p); close(); }}>{p}</button>
          ))}
        </div>
      )}
    </Popover>
  );
}
```

- [ ] **Step 4: `area-chip`**

Criar `frontend/components/task-chips/area-chip.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import { Popover } from "./popover";
import { cn } from "@/lib/utils";

export function AreaChip({ value, onChange }: { value: string | null; onChange: (nome: string | null) => void }) {
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => { fetch("/api/frentes").then((r) => r.json()).then((d) => setFrentes(d.frentes ?? [])).catch(() => {}); }, []);
  return (
    <Popover ariaLabel="Mudar área"
      trigger={() => (
        <span className={cn("inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full",
          value ? "bg-[color:var(--accent)] text-[color:var(--muted-strong)]"
                : "border border-dashed border-[color:var(--border)] text-[color:var(--muted)]")}>
          <Tag size={11} /> {value ?? "+ área"}
        </span>
      )}>
      {(close) => (
        <div className="flex flex-col max-h-64 overflow-y-auto">
          <button type="button" className="text-left text-sm px-2 py-1.5 rounded text-[color:var(--muted)] hover:bg-[color:var(--accent)]"
            onClick={() => { onChange(null); close(); }}>— sem área —</button>
          {frentes.map((f) => (
            <button key={f.id} type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)]"
              onClick={() => { onChange(f.nome); close(); }}>{f.nome}</button>
          ))}
        </div>
      )}
    </Popover>
  );
}
```

- [ ] **Step 5: `pra-quem-chip` (owner + acao)**

Criar `frontend/components/task-chips/pra-quem-chip.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { Popover } from "./popover";
import { cn } from "@/lib/utils";
import type { Acao } from "../task-row";

export type PraQuem = { owner: string; acao: Acao };

export function PraQuemChip({ value, onChange }: { value: PraQuem; onChange: (v: PraQuem) => void }) {
  const [owners, setOwners] = useState<{ name: string; is_me: boolean }[]>([]);
  const [txt, setTxt] = useState("");
  useEffect(() => { fetch("/api/owners").then((r) => r.json()).then((d) => setOwners(d.owners ?? [])).catch(() => {}); }, []);
  const isMe = value.owner === "vitor" && value.acao === "executar";
  const label = isMe ? "eu" : value.owner === "?" ? "alguém" : value.owner;
  const filtered = owners.filter((o) => !o.is_me && o.name.toLowerCase().includes(txt.toLowerCase()));
  return (
    <Popover ariaLabel="Mudar responsável"
      trigger={() => (
        <span className={cn("inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full",
          isMe ? "bg-[color:var(--calm-bg)] text-[color:var(--calm)]" : "bg-[color:var(--warm-bg)] text-[color:var(--warm)]")}>
          <UserRound size={11} /> {isMe ? "eu" : `${value.acao === "cobrar" ? "cobrar" : "aguardar"} ${label}`}
        </span>
      )}>
      {(close) => (
        <div className="flex flex-col">
          <button type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)] font-medium"
            onClick={() => { onChange({ owner: "vitor", acao: "executar" }); close(); }}>eu (executar)</button>
          <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="delegar a…"
            onKeyDown={(e) => { if (e.key === "Enter" && txt.trim()) { onChange({ owner: txt.trim(), acao: "cobrar" }); close(); } }}
            className="mx-1 my-1 px-2 py-1 text-sm rounded border border-[color:var(--border)] bg-transparent" />
          {filtered.map((o) => (
            <button key={o.name} type="button" className="text-left text-sm px-2 py-1.5 rounded hover:bg-[color:var(--accent)]"
              onClick={() => { onChange({ owner: o.name, acao: "cobrar" }); close(); }}>cobrar {o.name}</button>
          ))}
          {!isMe && (
            <button type="button" className="text-left text-[12px] px-2 py-1.5 rounded text-[color:var(--muted)] hover:bg-[color:var(--accent)]"
              onClick={() => { onChange({ owner: value.owner, acao: value.acao === "cobrar" ? "aguardar" : "cobrar" }); close(); }}>
              alternar p/ {value.acao === "cobrar" ? "aguardar" : "cobrar"}
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}
```

- [ ] **Step 6: Type-check + commit**

Run: `bunx tsc --noEmit` → sem erros.
```bash
git add frontend/components/task-chips/
git commit -m "feat(chips): popover mínimo + chips quando/pra-quem/prioridade/área"
```

---

## Task 8: Compositor + montagem na home

**Files:**
- Create: `frontend/components/capture-composer.tsx`
- Modify: `frontend/components/tasks-dashboard.tsx` (montar o compositor; manter "Nova tarefa" como "abrir tudo")

- [ ] **Step 1: O compositor**

Criar `frontend/components/capture-composer.tsx`:

```tsx
"use client";
import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic, CornerDownLeft, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuandoChip } from "./task-chips/quando-chip";
import { PraQuemChip, type PraQuem } from "./task-chips/pra-quem-chip";
import { PrioridadeChip } from "./task-chips/prioridade-chip";
import { AreaChip } from "./task-chips/area-chip";
import type { Tarefa } from "./task-row";
import type { Prioridade } from "@/lib/utils";

export function CaptureComposer({ onOpenFull }: { onOpenFull: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [texto, setTexto] = useState("");
  const [criada, setCriada] = useState<Tarefa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // atalho in-app: tecla "c" foca o campo (quando nada focado)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (e.key === "c" && tag !== "input" && tag !== "textarea") { e.preventDefault(); inputRef.current?.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function capturar() {
    const t = texto.trim();
    if (!t) { setErro("escreve algo primeiro"); return; }
    setErro(null);
    startTransition(async () => {
      try {
        const r = await fetch("/api/capturar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto: t }),
        });
        if (!r.ok) { setErro((await r.json().catch(() => ({}))).error ?? `erro ${r.status}`); return; }
        const tarefa = (await r.json()) as Tarefa;
        setCriada(tarefa);
        setTexto("");
        router.refresh();
      } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    });
  }

  // PATCH otimista de um campo da tarefa recém-criada
  function patch(body: Record<string, unknown>) {
    if (!criada) return;
    setCriada({ ...criada, ...body } as Tarefa);
    fetch(`/api/tarefas/${criada.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(() => router.refresh()).catch(() => {});
  }

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input ref={inputRef} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="O que precisa ser feito? (escreve e Enter)"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); capturar(); } }}
          className="flex-1 px-2 py-1.5 bg-transparent text-sm focus:outline-none" />
        <button type="button" title="Capturar por voz (em breve)" disabled
          className="text-[color:var(--muted)] opacity-40 cursor-not-allowed"><Mic size={18} /></button>
        <button type="button" onClick={capturar} disabled={isPending}
          className="inline-flex items-center gap-1 text-[13px] px-2.5 py-1 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] disabled:opacity-50">
          <CornerDownLeft size={14} /> {isPending ? "…" : "criar"}
        </button>
        <button type="button" onClick={onOpenFull} title="Abrir formulário completo"
          className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"><Plus size={18} /></button>
      </div>

      {erro && <p className="text-xs text-[color:var(--urgent)] px-2">{erro}</p>}

      {criada && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1 border-t border-[color:var(--border)]">
          <span className="text-[12px] text-[color:var(--muted)]">criada:</span>
          <span className="text-[13px] font-medium">{criada.titulo}</span>
          <PraQuemChip value={{ owner: criada.owner, acao: criada.acao }}
            onChange={(v: PraQuem) => patch({ owner: v.owner, acao: v.acao })} />
          <QuandoChip value={criada.prazo} onChange={(iso) => patch({ prazo: iso, prazo_text: null })} />
          <PrioridadeChip value={criada.prioridade as Prioridade} onChange={(p) => patch({ prioridade: p })} />
          <AreaChip value={criada.frente} onChange={(nome) => patch({ area_raw: nome })} />
          <button type="button" onClick={() => setCriada(null)} className="text-[12px] text-[color:var(--muted)] hover:text-[color:var(--foreground)] ml-auto">ok</button>
        </div>
      )}
    </div>
  );
}
```

> `PATCH /api/tarefas/[id]` precisa aceitar `acao`, `area_raw` e `prazo_text` (além de `owner`/`prazo`/`prioridade`). Confirme no Step 2.

- [ ] **Step 2: Garantir o PATCH aceita os campos do chip**

Abrir `frontend/app/api/tarefas/[id]/route.ts`. Confirmar que o PATCH aceita `owner`, `acao`, `prazo`, `prazo_text`, `prioridade`. Se **não** aceitar `area_raw`, adicionar suporte (setar `area_raw` deixa o trigger reresolver `frente_id`). Mostrar o trecho de whitelist de campos e incluir `"acao"`, `"area_raw"`, `"prazo_text"` se faltarem. (Se o handler usa `tarefasFor().update`, estender o `Pick` em `queries.ts:259-263` pra incluir `owner`/`acao`/`prazo_text`/`area_raw`.)

- [ ] **Step 3: Montar na home**

Em `frontend/components/tasks-dashboard.tsx`: importar `CaptureComposer` e, no topo do bloco sticky (antes do `<div className="flex justify-end">` em ~218), renderizar:

```tsx
<CaptureComposer onOpenFull={() => setCreating(true)} />
```
Manter o botão "Nova tarefa" existente (vira o caminho "completo"); pode reduzir seu destaque, mas **não remover**.

- [ ] **Step 4: Type-check + rodar o app**

Run: `bunx tsc --noEmit` → sem erros.
Verificação manual (ambiente com DB acessível): digitar "ligar pro contador sexta", Enter → card aparece na lista; chips aparecem preenchidos; tocar "quando" muda o prazo e a lista atualiza.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/capture-composer.tsx frontend/components/tasks-dashboard.tsx frontend/app/api/tarefas/
git commit -m "feat(captura): compositor com chips na home + abrir-tudo"
```

---

## Task 9: Marcador "revisar" no card + voz

**Files:**
- Modify: `frontend/components/task-row.tsx` (chip "revisar" quando `precisa_revisao`)
- Modify: `frontend/components/capture-composer.tsx` (habilitar gravação de voz)

- [ ] **Step 1: Chip "revisar" no card**

Em `frontend/components/task-row.tsx`, na linha de chips do topo (~355, junto de "vencida"/"urgente"), adicionar:

```tsx
{tarefa.precisa_revisao && (
  <span title="IA com baixa confiança — confira prazo / pessoa / área"
    className="inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase font-bold px-2 py-0.5 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] border border-[color:var(--warm)]/40">
    revisar
  </span>
)}
```
(O type `Tarefa` em `task-row.tsx:29-48` precisa do campo `precisa_revisao: boolean;` — adicionar.)

- [ ] **Step 2: Voz no compositor**

Substituir o botão `<Mic>` desabilitado por gravação real (MediaRecorder). No `capture-composer.tsx`, adicionar:

```tsx
const [gravando, setGravando] = useState(false);
const recRef = useRef<MediaRecorder | null>(null);
const chunksRef = useRef<Blob[]>([]);

async function toggleVoz() {
  if (gravando) { recRef.current?.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => chunksRef.current.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      enviarAudio(blob);
      setGravando(false);
    };
    recRef.current = rec; rec.start(); setGravando(true);
  } catch { setErro("microfone bloqueado neste navegador"); }
}

function enviarAudio(blob: Blob) {
  startTransition(async () => {
    try {
      const form = new FormData();
      form.append("audio", blob, "captura.webm");
      const r = await fetch("/api/capturar", { method: "POST", body: form });
      if (!r.ok) { setErro((await r.json().catch(() => ({}))).error ?? `erro ${r.status}`); return; }
      setCriada((await r.json()) as Tarefa); router.refresh();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  });
}
```
E trocar o botão do mic por:
```tsx
<button type="button" onClick={toggleVoz} title="Capturar por voz"
  className={cn("text-[color:var(--muted)] hover:text-[color:var(--foreground)]", gravando && "text-[color:var(--urgent)] animate-pulse")}>
  <Mic size={18} />
</button>
```

- [ ] **Step 3: Type-check + verificação**

Run: `bunx tsc --noEmit` → sem erros.
Verificação manual: card de tarefa de baixa confiança mostra "revisar"; no desktop, segurar/clicar o mic grava → transcreve → cria. (No iOS Safari PWA o mic pode ser bloqueado — comportamento esperado: toast "microfone bloqueado", texto segue funcionando.)

- [ ] **Step 4: Commit**

```bash
git add frontend/components/task-row.tsx frontend/components/capture-composer.tsx
git commit -m "feat(captura): marcador revisar no card + captura por voz"
```

---

## Self-Review (resultado)

**Cobertura do spec:**
- Compositor texto + auto-estrutura → Tasks 4,5,8 ✅
- Título limpo / palavras preservadas (Decisão 10) → prompt na Task 4 ✅
- Chips quem/quando/prioridade/área editáveis → Task 7+8 ✅
- `precisa_revisao` + marcador → Tasks 1,3,9 ✅
- Helper `criar` compartilhado, shape completo, dois caminhos de pessoas → Task 2 ✅
- Fallback "captura nunca falha" → Task 5 ✅
- Voz (transcrição → mesmo caminho) → Tasks 5,9 ✅
- `/api/owners` → Task 6 ✅
- Form completo preservado ("abrir tudo") → Task 8 ✅
- Fora de escopo (WhatsApp, iOS, recorrentes, "Hoje", import, migração total dos chips do card) → não há tasks ✅

**Placeholders:** nenhum "TBD/handle edge cases" — código completo em cada passo. Único ponto aberto deliberado: `usage_events` marcado como opcional (Task 5, nota).

**Consistência de tipos:** `CaptureDraft`/`RawDraft`/`normalizeDraft`/`precisaRevisao` (Task 3) usados igual na Task 4/5; `TarefaDraft`/`CriarMeta`/`criar` (Task 2) batem com a chamada na Task 5; `PraQuem` (Task 7) usado no compositor (Task 8). `area_raw`/`prazo_text` no PATCH conferidos na Task 8 Step 2.

**Riscos conhecidos a validar na execução:**
1. `PATCH /api/tarefas/[id]` pode não aceitar `acao`/`area_raw`/`prazo_text` — Task 8 Step 2 cobre.
2. Latência/modelo do `parseCapture` — Task 4 Step 4 (protótipo) é o gate.
3. Verificação de rotas/UI depende de ambiente com DB acessível (ver "Realidades do repo").

---

## Execução

Plano salvo em `docs/superpowers/plans/2026-06-08-captura-sem-friccao.md`. Duas opções de execução:

1. **Subagent-Driven (recomendado)** — eu disparo um subagente fresco por task, reviso entre tasks, iteração rápida.
2. **Inline** — executo as tasks nesta sessão (executing-plans), em lotes com checkpoints.

Qual prefere? (Ou pausa aqui e executa depois.)

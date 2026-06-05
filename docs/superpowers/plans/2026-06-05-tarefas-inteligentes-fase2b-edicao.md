# Tarefas Inteligentes — Fase 2b (Edição de área + pessoas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps com checkbox.

**Goal:** Permitir, no modal da tarefa, trocar a frente/área, aprovar a área sugerida pela IA, e adicionar/remover pessoas envolvidas (com principal) — o "poder já selecionar isso".

**Architecture:** O `TaskEditModal` busca as frentes do usuário (GET `/api/frentes`) ao abrir; ganha um `<select>` de frente, um botão "aprovar sugestão" (POST `/api/frentes` cria a frente da proposta), e um editor de pessoas (chips add/remove + estrela de principal). No save, o PATCH `/api/tarefas/[id]` passa a aceitar `frente_id` (seta + limpa `frente_proposta`) e `pessoas` (sincroniza `tarefa_pessoas` com get-or-create).

**Tech Stack:** Next.js 16 App Router, node-postgres `withTenant`, deploy via GHA→GHCR→swarm.

---

## File Structure
- **Modify** `frontend/lib/queries.ts` — `frentesFor(userId)` (list + create).
- **Create** `frontend/app/api/frentes/route.ts` — GET (lista) + POST (cria frente).
- **Modify** `frontend/app/api/tarefas/[id]/route.ts` — PATCH aceita `frente_id` + `pessoas`.
- **Modify** `frontend/components/task-edit-modal.tsx` — UI de área + pessoas.

---

## Task 1: `frentesFor` query helper

**Files:** Modify `frontend/lib/queries.ts`

- [ ] **Step 1: Adicionar o helper** (após o bloco `pessoasFor`, antes do final do arquivo)
```ts
// ─── frentesFor ───────────────────────────────────────────────────────
export const frentesFor = (userId: string) => ({
  list: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM frentes WHERE ativo ORDER BY ordem, nome`,
      );
      return r.rows;
    }),
  /** get-or-create por slug; retorna a frente. */
  create: (nome: string) =>
    withTenant(userId, async (db) => {
      const r = await db.query<{ id: string; nome: string }>(
        `INSERT INTO frentes (user_id, nome, slug, ordem)
         VALUES ($1, $2, app_slugify($2), 999)
         ON CONFLICT (user_id, slug) DO UPDATE SET ativo = true
         RETURNING id, nome`,
        [userId, nome.trim()],
      );
      return r.rows[0];
    }),
});
```
- [ ] **Step 2: Typecheck** `cd frontend && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -viE 'bun:test|detect-cuts' || echo OK`
- [ ] **Step 3: Commit** `git add frontend/lib/queries.ts && git commit -m "feat(queries): frentesFor (list + create)"`

## Task 2: `/api/frentes` route

**Files:** Create `frontend/app/api/frentes/route.ts`

- [ ] **Step 1: Criar a rota**
```ts
import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { frentesFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (user) => {
  const frentes = await frentesFor(user.id).list();
  return NextResponse.json({ frentes });
});

export const POST = withAuth(async (user, req) => {
  let body: { nome?: string };
  try {
    body = (await (req as NextRequest).json()) as { nome?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nome = (body.nome ?? "").trim();
  if (!nome) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  const frente = await frentesFor(user.id).create(nome);
  return NextResponse.json({ frente });
});
```
- [ ] **Step 2: Typecheck + commit**
```bash
cd frontend && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -viE 'bun:test|detect-cuts' || echo OK
cd .. && git add frontend/app/api/frentes/route.ts && git commit -m "feat(api): /api/frentes GET (lista) + POST (cria)"
```

## Task 3: PATCH tarefa aceita frente_id + pessoas

**Files:** Modify `frontend/app/api/tarefas/[id]/route.ts`

- [ ] **Step 1: Estender o tipo `PatchBody`** — adicionar à definição:
```ts
  frente_id: string | null;
  pessoas: { nome: string; principal?: boolean }[];
```
- [ ] **Step 2: Tratar `frente_id`** — após o bloco `if (body.acao !== undefined) {...}`, adicionar:
```ts
  if (body.frente_id !== undefined) {
    push("frente_id", body.frente_id);
    if (body.frente_id) sets.push("frente_proposta = NULL");
  }
```
- [ ] **Step 3: Não exigir UPDATE quando só vierem pessoas** — substituir o guard `if (!sets.length) {...}` por:
```ts
  const hasPessoas = Array.isArray(body.pessoas);
  if (!sets.length && !hasPessoas) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
  }
```
- [ ] **Step 4: Rodar UPDATE só se houver sets; sincronizar pessoas** — localizar onde monta/roda o `UPDATE tarefas SET ... RETURNING *` dentro do `withTenant`, e ajustar pra:
   - rodar o UPDATE apenas se `sets.length > 0` (senão buscar a row atual);
   - depois, se `hasPessoas`, sincronizar `tarefa_pessoas`.

   O bloco `withTenant` passa a ser:
```ts
    const updated = await withTenant(user.id, async (c) => {
      let row;
      if (sets.length) {
        values.push(id);
        const sql = `UPDATE tarefas SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`;
        const { rows } = await c.query(sql, values);
        row = rows[0];
        if (row && body.status) {
          const evento =
            body.status === "concluida" ? "concluida"
            : body.status === "cancelada" ? "cancelada"
            : "reaberta";
          await c.query(
            "INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,$2,$3)",
            [id, evento, JSON.stringify(body)],
          );
        }
      } else {
        const { rows } = await c.query("SELECT * FROM tarefas WHERE id = $1", [id]);
        row = rows[0];
      }
      if (!row) return null;
      if (hasPessoas) {
        await c.query("DELETE FROM tarefa_pessoas WHERE tarefa_id = $1", [id]);
        for (const p of body.pessoas!) {
          const nome = (p.nome || "").trim();
          if (!nome || nome === "?") continue;
          const pr = await c.query<{ id: string }>(
            `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
             ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
            [user.id, nome],
          );
          await c.query(
            `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,$3)
             ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal`,
            [id, pr.rows[0].id, !!p.principal],
          );
        }
      }
      return row;
    });
```
   (Remover as linhas antigas que montavam `sql`/rodavam o UPDATE fora desse novo bloco, e o `values.push(id)` duplicado.)
- [ ] **Step 5: Typecheck + commit**
```bash
cd frontend && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -viE 'bun:test|detect-cuts' || echo OK
cd .. && git add "frontend/app/api/tarefas/[id]/route.ts" && git commit -m "feat(api/tarefas): PATCH aceita frente_id + sync de pessoas"
```

## Task 4: UI no TaskEditModal (área + pessoas)

**Files:** Modify `frontend/components/task-edit-modal.tsx`

- [ ] **Step 1: Estado + fetch de frentes** — após os `useState` existentes, adicionar:
```ts
  const [frenteId, setFrenteId] = useState<string | null>(
    // frente_id não vem no tipo Tarefa; derivamos por nome ao carregar a lista
    null,
  );
  const [frentes, setFrentes] = useState<{ id: string; nome: string }[]>([]);
  const [pessoas, setPessoas] = useState<{ nome: string; principal: boolean }[]>(
    (tarefa.pessoas ?? []).map((p) => ({ nome: p.nome, principal: p.principal })),
  );
  const [novaPessoa, setNovaPessoa] = useState("");

  useEffect(() => {
    fetch("/api/frentes")
      .then((r) => r.json())
      .then((d: { frentes?: { id: string; nome: string }[] }) => {
        const list = d.frentes ?? [];
        setFrentes(list);
        const atual = list.find((f) => f.nome === tarefa.frente);
        if (atual) setFrenteId(atual.id);
      })
      .catch(() => {});
  }, [tarefa.frente]);
```
- [ ] **Step 2: Incluir no payload do save** — em `handleSave`, no objeto `payload`, adicionar:
```ts
          frente_id: frenteId,
          pessoas,
```
- [ ] **Step 3: Bloco de UI de Área** — adicionar antes do bloco de Status (`<label>Status</label>`):
```tsx
          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Área
            </label>
            <select
              value={frenteId ?? ""}
              onChange={(e) => setFrenteId(e.target.value || null)}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            >
              <option value="">— sem área —</option>
              {frentes.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
            {!frenteId && tarefa.frente_proposta && (
              <button
                type="button"
                onClick={async () => {
                  const r = await fetch("/api/frentes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nome: tarefa.frente_proposta }),
                  });
                  const d = (await r.json()) as { frente?: { id: string; nome: string } };
                  if (d.frente) {
                    setFrentes((prev) =>
                      prev.some((f) => f.id === d.frente!.id) ? prev : [...prev, d.frente!],
                    );
                    setFrenteId(d.frente.id);
                  }
                }}
                className="mt-1.5 text-[11px] px-2 py-1 rounded-full bg-[color:var(--warm-bg)] text-[color:var(--warm)] border border-dashed border-[color:var(--warm)]/40"
              >
                + aprovar sugestão: {tarefa.frente_proposta}
              </button>
            )}
          </div>
```
- [ ] **Step 4: Bloco de UI de Pessoas** — adicionar logo após o bloco de Área:
```tsx
          <div>
            <label className="text-xs font-medium text-[color:var(--muted)] block mb-1">
              Pessoas envolvidas
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {pessoas.map((p, i) => (
                <span
                  key={`${p.nome}-${i}`}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-[color:var(--border)]"
                >
                  <button
                    type="button"
                    title={p.principal ? "Principal (agrupa por esta)" : "Marcar como principal"}
                    onClick={() =>
                      setPessoas((prev) => prev.map((x, j) => ({ ...x, principal: j === i })))
                    }
                    className={cn(p.principal ? "text-[color:var(--warm)]" : "text-[color:var(--muted)]")}
                  >
                    {p.principal ? "★" : "☆"}
                  </button>
                  {p.nome}
                  <button
                    type="button"
                    onClick={() => setPessoas((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[color:var(--muted)] hover:text-[color:var(--urgent)]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={novaPessoa}
                onChange={(e) => setNovaPessoa(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const nome = novaPessoa.trim();
                    if (nome && !pessoas.some((p) => p.nome.toLowerCase() === nome.toLowerCase())) {
                      setPessoas((prev) => [...prev, { nome, principal: prev.length === 0 }]);
                    }
                    setNovaPessoa("");
                  }
                }}
                placeholder="adicionar pessoa + Enter"
                className="flex-1 px-3 py-2 rounded-md border border-[color:var(--border)] bg-transparent text-sm focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              />
            </div>
          </div>
```
- [ ] **Step 5: Typecheck + lint + commit**
```bash
cd frontend && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -viE 'bun:test|detect-cuts' || echo OK
bunx eslint components/task-edit-modal.tsx app/api/frentes/route.ts || true
cd .. && git add frontend/components/task-edit-modal.tsx && git commit -m "feat(task-edit): editar área (com aprovar sugestão) + pessoas (add/remove/principal)"
```

## Task 5: Build + deploy + verificação
- [ ] **Step 1:** `cd frontend && bun run build 2>&1 | tail -5` → compila.
- [ ] **Step 2:** push + `gh run watch` do frontend.yml → ✓.
- [ ] **Step 3:** `docker service update --image ghcr.io/vitorfawkes/assistente-pessoal-frontend:$(git rev-parse HEAD) --force n8n_assistente-frontend` → converged.
- [ ] **Step 4:** Abrir uma tarefa em /reunioes/0bc856aa, mudar a área e as pessoas, salvar; confirmar que o card reflete e o agrupamento muda.

## Self-Review
- Spec §3 "edição inline (mudar área, add/remove pessoa, aprovar frente_proposta)" → Tasks 1-4. ✓ (via modal, não inline-chip — decisão de robustez registrada.)
- Risco: sync de pessoas apaga+reinsere `tarefa_pessoas` da tarefa (ok, escopo é por-tarefa). Principal: estrela única; se nenhuma marcada e há pessoas, a 1ª add vira principal — usuário ajusta.

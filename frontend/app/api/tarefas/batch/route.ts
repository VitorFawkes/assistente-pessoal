import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_STATUS = ["aberta", "em_andamento", "concluida", "cancelada"] as const;
const VALID_PRIORIDADE = ["baixa", "media", "alta", "urgente"] as const;
const VALID_ACAO = ["executar", "cobrar", "aguardar"] as const;

// Campos aceitos numa edição em massa. `acao`/`owner` são tratados à parte
// (mantêm o invariante executar⇔vitor e recalculam o `principal`).
type BatchPatch = Partial<{
  status: (typeof VALID_STATUS)[number];
  prazo: string | null;
  prioridade: (typeof VALID_PRIORIDADE)[number];
  acao: (typeof VALID_ACAO)[number];
  owner: string;
  frente_id: string | null;
}>;

function parseIds(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
}

// PATCH /api/tarefas/batch — aplica uma edição a várias tarefas de uma vez.
// Body: { ids: string[], patch: BatchPatch }. RLS garante que só as do próprio user mudam.
export const PATCH = withAuth(async (user, req) => {
  let body: { ids?: unknown; patch?: BatchPatch };
  try {
    body = (await (req as NextRequest).json()) as { ids?: unknown; patch?: BatchPatch };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const ids = parseIds(body.ids);
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids vazio" }, { status: 400 });
  }
  const patch = body.patch ?? {};

  // Validação dos enums antes de tocar no banco.
  if (patch.status !== undefined && !VALID_STATUS.includes(patch.status)) {
    return NextResponse.json({ error: "status inválido" }, { status: 400 });
  }
  if (patch.prioridade !== undefined && !VALID_PRIORIDADE.includes(patch.prioridade)) {
    return NextResponse.json({ error: "prioridade inválida" }, { status: 400 });
  }
  if (patch.acao !== undefined) {
    if (!VALID_ACAO.includes(patch.acao)) {
      return NextResponse.json({ error: "acao inválida" }, { status: 400 });
    }
    // cobrar/aguardar exigem um dono (a UI sempre manda) — executar força "vitor".
    if (patch.acao !== "executar" && !(patch.owner ?? "").trim()) {
      return NextResponse.json(
        { error: "owner obrigatório para cobrar/aguardar" },
        { status: 400 },
      );
    }
  }

  // SETs genéricos (status / prazo / prioridade / frente_id).
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  if (patch.status !== undefined) {
    push("status", patch.status);
    // desde quando está nesta situação — é o "entrou nesta coluna" do quadro
    sets.push("situacao_desde = now()");
    if (patch.status === "concluida") sets.push("concluida_em = now()");
    if (patch.status === "cancelada") sets.push("cancelada_em = now()");
    if (patch.status === "aberta" || patch.status === "em_andamento") {
      sets.push("concluida_em = NULL", "cancelada_em = NULL");
    }
  }
  if (patch.prazo !== undefined) push("prazo", patch.prazo);
  if (patch.prioridade !== undefined) push("prioridade", patch.prioridade);
  if (patch.frente_id !== undefined) {
    push("frente_id", patch.frente_id);
    if (patch.frente_id) sets.push("frente_proposta = NULL");
  }

  if (!sets.length && patch.acao === undefined) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
  }

  try {
    await withTenant(user.id, async (c) => {
      // 1) Campos genéricos num único UPDATE escopado por RLS.
      if (sets.length) {
        const v = [...values, ids];
        await c.query(
          `UPDATE tarefas SET ${sets.join(", ")} WHERE id = ANY($${v.length}::uuid[])`,
          v,
        );
      }

      // 2) Eventos de status (1 por tarefa) — histórico/auditoria.
      if (patch.status !== undefined) {
        const evento =
          patch.status === "concluida"
            ? "concluida"
            : patch.status === "cancelada"
            ? "cancelada"
            : "reaberta";
        await c.query(
          `INSERT INTO tarefa_eventos (tarefa_id, evento, payload)
             SELECT u.id, $2::text, $3::jsonb FROM unnest($1::uuid[]) AS u(id)`,
          [ids, evento, JSON.stringify({ origem: "massa", status: patch.status })],
        );
      }

      // 3) Ação + dono uniformes → espelha o resolve do PATCH individual.
      if (patch.acao !== undefined) {
        const acao = patch.acao;
        const owner = acao === "executar" ? "vitor" : (patch.owner ?? "").trim();
        await c.query(
          `UPDATE tarefas SET acao = $1, owner = $2 WHERE id = ANY($3::uuid[])`,
          [acao, owner, ids],
        );

        if (acao === "executar") {
          // ninguém é principal (agrupa em "Você")
          await c.query(
            `UPDATE tarefa_pessoas SET principal = false
               WHERE tarefa_id = ANY($1::uuid[]) AND principal`,
            [ids],
          );
        } else {
          await c.query(
            `UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = ANY($1::uuid[])`,
            [ids],
          );
          if (owner && owner !== "?" && owner.toLowerCase() !== "vitor") {
            const pr = await c.query<{ id: string }>(
              `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
               ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
              [user.id, owner],
            );
            const pessoaId = pr.rows[0].id;
            await c.query(
              `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal)
                 SELECT u.id, $2::uuid, true FROM unnest($1::uuid[]) AS u(id)
               ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = true`,
              [ids, pessoaId],
            );
          }
        }
      }
    });

    return NextResponse.json({ ok: true, count: ids.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

// DELETE /api/tarefas/batch — apaga várias de uma vez. Body: { ids: string[] }.
export const DELETE = withAuth(async (user, req) => {
  let body: { ids?: unknown };
  try {
    body = (await (req as NextRequest).json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const ids = parseIds(body.ids);
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids vazio" }, { status: 400 });
  }

  try {
    const deleted = await withTenant(user.id, async (c) => {
      await c.query("DELETE FROM tarefa_eventos WHERE tarefa_id = ANY($1::uuid[])", [ids]);
      const r = await c.query("DELETE FROM tarefas WHERE id = ANY($1::uuid[]) RETURNING id", [ids]);
      return r.rowCount ?? 0;
    });
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

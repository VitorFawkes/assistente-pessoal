import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

const VALID_STATUS = ["aberta", "em_andamento", "concluida", "cancelada"] as const;
const VALID_PRIORIDADE = ["baixa", "media", "alta", "urgente"] as const;
const VALID_ACAO = ["executar", "cobrar", "aguardar"] as const;

type PatchBody = Partial<{
  titulo: string;
  descricao: string | null;
  owner: string;
  acao: (typeof VALID_ACAO)[number];
  prazo: string | null;
  inicio: string | null;
  prazo_text: string | null;
  prioridade: (typeof VALID_PRIORIDADE)[number];
  status: (typeof VALID_STATUS)[number];
  frente_id: string | null;
  area_raw: string | null;
  no_plano: boolean;
  ordem: number | null;
  pessoas: { nome: string; principal?: boolean }[];
}>;

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await (req as NextRequest).json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  const push = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  if (body.titulo !== undefined) push("titulo", body.titulo);
  if (body.descricao !== undefined) push("descricao", body.descricao);
  if (body.owner !== undefined) push("owner", body.owner);
  if (body.acao !== undefined) {
    if (!VALID_ACAO.includes(body.acao)) {
      return NextResponse.json({ error: "acao inválida" }, { status: 400 });
    }
    push("acao", body.acao);
    // invariante: executar ⇔ a tarefa é do Vitor. Sem owner explícito, força "vitor".
    if (body.acao === "executar" && body.owner === undefined) push("owner", "vitor");
  }
  if (body.prazo !== undefined) push("prazo", body.prazo);
  if (body.inicio !== undefined) push("inicio", body.inicio);
  if (body.prazo_text !== undefined) push("prazo_text", body.prazo_text);
  if (body.prioridade !== undefined) {
    if (!VALID_PRIORIDADE.includes(body.prioridade)) {
      return NextResponse.json({ error: "prioridade inválida" }, { status: 400 });
    }
    push("prioridade", body.prioridade);
  }
  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status)) {
      return NextResponse.json({ error: "status inválido" }, { status: 400 });
    }
    push("status", body.status);
    if (body.status === "concluida") sets.push("concluida_em = now()");
    if (body.status === "cancelada") sets.push("cancelada_em = now()");
    if (body.status === "aberta" || body.status === "em_andamento") {
      sets.push("concluida_em = NULL", "cancelada_em = NULL");
    }
  }

  if (body.frente_id !== undefined) {
    push("frente_id", body.frente_id);
    if (body.frente_id) sets.push("frente_proposta = NULL");
  }

  if (body.area_raw !== undefined) {
    push("area_raw", body.area_raw);
  }

  if (body.ordem !== undefined) {
    push("ordem", body.ordem);
  }

  if (body.no_plano !== undefined) push("no_plano", body.no_plano);

  const hasPessoas = Array.isArray(body.pessoas);
  if (!sets.length && !hasPessoas) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
  }

  try {
    // Campos de CONTEÚDO cuja edição manual é sinal de correção (modelo errou → usuário corrigiu).
    // Vira evento 'editada' com de→para = dataset de feedback p/ afinar a extração (Fase 4).
    const CORRECTION_FIELDS = [
      "titulo", "descricao", "owner", "acao", "prazo", "prazo_text", "prioridade", "area_raw",
    ] as const;

    const updated = await withTenant(user.id, async (c) => {
      let row: Record<string, unknown> | undefined;
      if (sets.length) {
        // pega o estado ANTES p/ registrar a correção (de→para)
        const before = (
          await c.query<Record<string, unknown>>("SELECT * FROM tarefas WHERE id = $1", [id])
        ).rows[0];
        values.push(id);
        const sql = `UPDATE tarefas SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`;
        const { rows } = await c.query(sql, values);
        row = rows[0];
        if (row && body.status) {
          const evento =
            body.status === "concluida"
              ? "concluida"
              : body.status === "cancelada"
              ? "cancelada"
              : "reaberta";
          await c.query(
            "INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,$2,$3)",
            [id, evento, JSON.stringify(body)],
          );
        }
        // correção de conteúdo: registra de→para por campo alterado
        if (row && before) {
          const changed: Record<string, { de: unknown; para: unknown }> = {};
          for (const f of CORRECTION_FIELDS) {
            if (body[f as keyof PatchBody] !== undefined && before[f] !== row[f]) {
              changed[f] = { de: before[f], para: row[f] };
            }
          }
          if (Object.keys(changed).length) {
            await c.query(
              "INSERT INTO tarefa_eventos (tarefa_id, evento, payload) VALUES ($1,'editada',$2)",
              [id, JSON.stringify({ origem: "correcao_manual", changed })],
            );
            // dataset persistente p/ o loop de feedback (sobrevive à deleção da tarefa)
            await c.query(
              "INSERT INTO extracao_feedback (user_id, meeting_id, tipo, payload) VALUES ($1,$2,'correcao',$3)",
              [user.id, (before.meeting_id as string) ?? null, JSON.stringify({ changed })],
            );
          }
        }
      } else {
        const { rows } = await c.query("SELECT * FROM tarefas WHERE id = $1", [id]);
        row = rows[0];
      }
      if (!row) return null;

      // Mudou dono/ação sem mandar `pessoas` explícitas → recalcula o flag `principal`
      // (que decide o agrupamento por pessoa). Espelha a trigger resolve_tarefa_pessoas:
      //   executar     → ninguém é principal (agrupa em "Você")
      //   cobrar/aguardar → principal = a pessoa do owner (cria/vincula se preciso)
      if (!hasPessoas && (body.owner !== undefined || body.acao !== undefined)) {
        const acao = String(row.acao ?? "");
        const owner = String(row.owner ?? "").trim();
        if (acao === "executar") {
          await c.query(
            "UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1 AND principal",
            [id],
          );
        } else {
          await c.query("UPDATE tarefa_pessoas SET principal = false WHERE tarefa_id = $1", [id]);
          if (owner && owner !== "?" && owner.toLowerCase() !== "vitor") {
            const found = await c.query<{ pessoa_id: string }>(
              `SELECT tp.pessoa_id FROM tarefa_pessoas tp
                 JOIN pessoas p ON p.id = tp.pessoa_id
                WHERE tp.tarefa_id = $1 AND app_slugify(p.nome) = app_slugify($2) LIMIT 1`,
              [id, owner],
            );
            let pessoaId = found.rows[0]?.pessoa_id;
            if (!pessoaId) {
              const pr = await c.query<{ id: string }>(
                `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
                 ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
                [user.id, owner],
              );
              pessoaId = pr.rows[0].id;
            }
            await c.query(
              `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,true)
               ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = true`,
              [id, pessoaId],
            );
          }
        }
      }

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

    if (!updated) {
      return NextResponse.json({ error: "tarefa não encontrada" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const rows = await withTenant(user.id, async (db) => {
    const r = await db.query("SELECT * FROM tarefas WHERE id = $1", [id]);
    return r.rows;
  });
  if (!rows.length) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  return NextResponse.json(rows[0]);
});

export const DELETE = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  // "não é tarefa": rejeição explícita → guarda exemplo negativo p/ o loop de feedback.
  const motivo = new URL((req as NextRequest).url).searchParams.get("motivo");
  try {
    const result = await withTenant(user.id, async (c) => {
      if (motivo === "nao_era_tarefa") {
        const snap = (
          await c.query<Record<string, unknown>>(
            "SELECT meeting_id, titulo, descricao, owner, acao, prazo_text, area_raw FROM tarefas WHERE id = $1",
            [id],
          )
        ).rows[0];
        if (snap) {
          await c.query(
            "INSERT INTO extracao_feedback (user_id, meeting_id, tipo, payload) VALUES ($1,$2,'rejeicao',$3)",
            [user.id, (snap.meeting_id as string) ?? null, JSON.stringify(snap)],
          );
        }
      }
      await c.query("DELETE FROM tarefa_eventos WHERE tarefa_id = $1", [id]);
      const t = await c.query("DELETE FROM tarefas WHERE id = $1 RETURNING id", [id]);
      return t.rowCount ?? 0;
    });
    if (result === 0) {
      return NextResponse.json({ error: "tarefa não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

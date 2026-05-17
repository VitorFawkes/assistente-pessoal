import { type NextRequest, NextResponse } from "next/server";
import { query, withClient } from "@/lib/db";

const VALID_STATUS = ["aberta", "em_andamento", "concluida", "cancelada"] as const;
const VALID_PRIORIDADE = ["baixa", "media", "alta", "urgente"] as const;

type PatchBody = Partial<{
  titulo: string;
  descricao: string | null;
  owner: string;
  prazo: string | null;
  prazo_text: string | null;
  prioridade: (typeof VALID_PRIORIDADE)[number];
  status: (typeof VALID_STATUS)[number];
}>;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
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
  if (body.prazo !== undefined) push("prazo", body.prazo);
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

  if (!sets.length) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
  }

  values.push(id);
  const sql = `UPDATE tarefas SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`;

  try {
    const updated = await withClient(async (c) => {
      const { rows } = await c.query(sql, values);
      if (rows[0] && body.status) {
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
      return rows[0];
    });

    if (!updated) {
      return NextResponse.json({ error: "tarefa não encontrada" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await query("SELECT * FROM tarefas WHERE id = $1", [id]);
  if (!rows.length) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

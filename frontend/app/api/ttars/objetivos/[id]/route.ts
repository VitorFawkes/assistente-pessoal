import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { carregarTarefas } from "@/lib/equipe-compartilhado";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

type PatchBody = {
  nome?: string;
  como_medir?: string | null;
  prazo?: string | null;
  visibilidade?: "so_eu" | "time" | "todos";
  time_id?: string | null;
};

export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  try {
    const { id } = await ctx.params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const [objetivo, tarefasPares, projetos] = await withTenant(user.id, async (c) => {
      const obj = await c.query<{
        id: string;
        nome: string;
        como_medir: string | null;
        prazo: string | null;
        visibilidade: string;
        time_id: string | null;
        user_id: string;
        total: number;
        feitas: number;
        vencidas: number;
        n_projetos: number;
      }>(
        `SELECT o.id, o.nome, o.como_medir, TO_CHAR(o.prazo, 'YYYY-MM-DD') AS prazo,
                o.visibilidade, o.time_id, o.user_id,
                COUNT(DISTINCT t.id) AS total,
                COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'concluida') AS feitas,
                COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao')
                                                  AND t.prazo < now()::date) AS vencidas,
                COUNT(DISTINCT q.id) AS n_projetos
           FROM objetivos o
           LEFT JOIN tarefas t ON t.objetivo_id = o.id
           LEFT JOIN quadros q ON q.objetivo_id = o.id
          WHERE o.id = $1 AND (o.user_id = $2 OR o.visibilidade = 'todos'
                            OR (o.visibilidade = 'time' AND o.time_id = ANY (equipe_meus_times())))
          GROUP BY o.id`,
        [id, user.id],
      );

      const tarefas = await c.query<{ tarefa_id: string; dono_id: string }>(
        `SELECT tarefa_id, dono_id FROM equipe_tarefas_do_objetivo($1)`,
        [id],
      );

      const proj = await c.query<{
        id: string;
        nome: string;
        time_id: string | null;
        objetivo_id: string | null;
        abertas: number;
        feitas: number;
        vencidas: number;
        proximo_prazo: string | null;
      }>(
        `SELECT q.id, q.nome, q.time_id, q.objetivo_id,
                COUNT(*) FILTER (WHERE t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao')) AS abertas,
                COUNT(*) FILTER (WHERE t.status = 'concluida') AS feitas,
                COUNT(*) FILTER (WHERE t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao')
                                      AND t.prazo < now()::date) AS vencidas,
                TO_CHAR(MIN(CASE WHEN t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao')
                                  AND t.prazo >= now()::date THEN t.prazo END), 'YYYY-MM-DD') AS proximo_prazo
           FROM quadros q
           LEFT JOIN quadro_tarefas qt ON qt.quadro_id = q.id
           LEFT JOIN tarefas t ON t.id = qt.tarefa_id
          WHERE q.objetivo_id = $1
          GROUP BY q.id, q.nome, q.time_id, q.objetivo_id`,
        [id],
      );

      return [obj.rows[0], tarefas.rows, proj.rows];
    });

    if (!objetivo) {
      return NextResponse.json({ error: "objetivo não encontrado" }, { status: 404 });
    }

    const tarefas = tarefasPares.length > 0 ? await carregarTarefas(user.id, tarefasPares) : [];

    // Carregar nomes de criador e time do objetivo
    const criadorNome = await withTenant(user.id, async (c) => {
      const r = await c.query<{ nome: string }>(
        `SELECT nome FROM users WHERE id = $1`,
        [objetivo.user_id],
      );
      return r.rows[0]?.nome ?? null;
    });

    const timeNomeObj = objetivo.time_id
      ? await withTenant(user.id, async (c) => {
          const r = await c.query<{ nome: string }>(
            `SELECT nome FROM ttars_pessoas WHERE id = $1`,
            [objetivo.time_id],
          );
          return r.rows[0]?.nome ?? null;
        })
      : null;

    // Carregar nomes de times para projetos
    const timesNomes = new Map<string, string>();
    const tidsUnicos = [...new Set(projetos.filter((p) => p.time_id).map((p) => p.time_id))];
    if (tidsUnicos.length > 0) {
      const r = await withTenant(user.id, async (c) => {
        return c.query<{ id: string; nome: string }>(
          `SELECT id, nome FROM ttars_pessoas WHERE id = ANY ($1)`,
          [tidsUnicos],
        );
      });
      for (const row of r.rows) {
        timesNomes.set(row.id, row.nome);
      }
    }

    // Carregar nomes de objetivos para projetos
    const objetivosNomes = new Map<string, string>();
    const obidsUnicos = [...new Set(projetos.filter((p) => p.objetivo_id).map((p) => p.objetivo_id))];
    if (obidsUnicos.length > 0) {
      const r = await withTenant(user.id, async (c) => {
        return c.query<{ id: string; nome: string }>(
          `SELECT id, nome FROM objetivos WHERE id = ANY ($1)`,
          [obidsUnicos],
        );
      });
      for (const row of r.rows) {
        objetivosNomes.set(row.id, row.nome);
      }
    }

    return NextResponse.json({
      objetivo: {
        ...objetivo,
        sou_dono: objetivo.user_id === user.id,
        criador_nome: criadorNome,
        time_nome: timeNomeObj,
      },
      projetos: projetos.map((p) => ({
        ...p,
        time_nome: p.time_id ? (timesNomes.get(p.time_id) ?? null) : null,
        objetivo: p.objetivo_id ? { id: p.objetivo_id, nome: objetivosNomes.get(p.objetivo_id) ?? null } : null,
      })),
      tarefas,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  try {
    const { id } = await ctx.params;
    const body: PatchBody = await req.json();

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    if (body.nome !== undefined && (body.nome.length === 0 || body.nome.length > 200)) {
      return NextResponse.json({ error: "nome inválido" }, { status: 400 });
    }

    if (body.time_id && !body.time_id.match(/^t-[a-z0-9-]+$/i)) {
      return NextResponse.json({ error: "time_id inválido" }, { status: 400 });
    }

    if (body.prazo && !body.prazo.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return NextResponse.json({ error: "prazo deve ser AAAA-MM-DD" }, { status: 400 });
    }

    if (body.visibilidade && !["so_eu", "time", "todos"].includes(body.visibilidade)) {
      return NextResponse.json({ error: "visibilidade inválida" }, { status: 400 });
    }

    const sets: string[] = [];
    const values: unknown[] = [id, user.id];

    if (body.nome !== undefined) {
      sets.push(`nome = $${values.length + 1}`);
      values.push(body.nome.trim());
    }

    if (body.como_medir !== undefined) {
      sets.push(`como_medir = $${values.length + 1}`);
      values.push(body.como_medir?.trim() ?? null);
    }

    if (body.prazo !== undefined) {
      sets.push(`prazo = $${values.length + 1}::date`);
      values.push(body.prazo ?? null);
    }

    if (body.visibilidade !== undefined) {
      sets.push(`visibilidade = $${values.length + 1}`);
      values.push(body.visibilidade);
    }

    if (body.time_id !== undefined) {
      sets.push(`time_id = $${values.length + 1}`);
      values.push(body.time_id ?? null);
    }

    if (!sets.length) {
      return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
    }

    sets.push("updated_at = now()");

    const resultado = await withTenant(user.id, async (c) => {
      const r = await c.query<{ id: string }>(
        `UPDATE objetivos SET ${sets.join(", ")}
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        values,
      );
      return r.rows[0];
    });

    if (!resultado) {
      return NextResponse.json({ error: "objetivo não encontrado" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  try {
    const { id } = await ctx.params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const resultado = await withTenant(user.id, async (c) => {
      const r = await c.query<{ id: string }>(
        `UPDATE objetivos SET archived_at = now() WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, user.id],
      );
      return r.rows[0];
    });

    if (!resultado) {
      return NextResponse.json({ error: "objetivo não encontrado" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

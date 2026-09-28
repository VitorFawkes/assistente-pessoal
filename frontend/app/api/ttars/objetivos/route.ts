import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PostBody = {
  nome: string;
  como_medir?: string;
  prazo?: string;
  visibilidade: "so_eu" | "time" | "todos";
  time_id?: string | null;
};

export const GET = withAuth(async (user) => {
  try {
    const objetivos = await withTenant(user.id, async (c) => {
      const r = await c.query<{
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
          WHERE o.archived_at IS NULL
            AND (o.user_id = $1 OR o.visibilidade = 'todos'
                 OR (o.visibilidade = 'time' AND o.time_id = ANY (equipe_meus_times())))
          GROUP BY o.id
          ORDER BY o.nome`,
        [user.id],
      );
      return r.rows;
    });

    // Carregar nomes de criadores
    const criadores = new Map<string, string>();
    const uidsUnicos = [...new Set(objetivos.map((o) => o.user_id))];
    if (uidsUnicos.length > 0) {
      const r = await withTenant(user.id, async (c) => {
        return c.query<{ id: string; nome: string }>(
          `SELECT id, nome FROM users WHERE id = ANY ($1)`,
          [uidsUnicos],
        );
      });
      for (const row of r.rows) {
        criadores.set(row.id, row.nome);
      }
    }

    // Carregar nomes de times
    const timesNomes = new Map<string, string>();
    const tidsUnicos = [...new Set(objetivos.filter((o) => o.time_id).map((o) => o.time_id))];
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

    const com_nomes = objetivos.map((o) => ({
      ...o,
      sou_dono: o.user_id === user.id,
      criador_nome: criadores.get(o.user_id) ?? null,
      time_nome: o.time_id ? (timesNomes.get(o.time_id) ?? null) : null,
    }));

    return NextResponse.json({ objetivos: com_nomes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

export const POST = withAuth(async (user, req) => {
  try {
    const body: PostBody = await req.json();

    if (!body.nome || body.nome.trim().length === 0 || body.nome.length > 200) {
      return NextResponse.json({ error: "nome inválido" }, { status: 400 });
    }

    if (body.time_id && !body.time_id.match(/^t-[a-z0-9-]+$/i)) {
      return NextResponse.json({ error: "time_id inválido" }, { status: 400 });
    }

    if (body.prazo && !body.prazo.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return NextResponse.json({ error: "prazo deve ser AAAA-MM-DD" }, { status: 400 });
    }

    if (!["so_eu", "time", "todos"].includes(body.visibilidade)) {
      return NextResponse.json({ error: "visibilidade inválida" }, { status: 400 });
    }

    const resultado = await withTenant(user.id, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO objetivos (user_id, nome, como_medir, prazo, visibilidade, time_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4::date, $5, $6, now(), now())
         RETURNING id`,
        [
          user.id,
          body.nome.trim(),
          body.como_medir?.trim() ?? null,
          body.prazo ?? null,
          body.visibilidade,
          body.time_id ?? null,
        ],
      );
      return r.rows[0];
    });

    return NextResponse.json({ id: resultado?.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

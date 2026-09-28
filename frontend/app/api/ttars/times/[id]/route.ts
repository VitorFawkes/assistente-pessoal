import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { pessoasDaEquipe, carregarTarefas } from "@/lib/equipe-compartilhado";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  try {
    const { id } = await ctx.params;
    const timeId = id.trim();

    // Verificar permissão: é admin ou está no time
    const pessoas = await pessoasDaEquipe();
    const meusTimes = pessoas
      .find((p) => p.email.toLowerCase() === user.email?.toLowerCase())
      ?.times?.map((t) => t.id) ?? [];

    const temPermissao = (await withTenant(user.id, async (c) => {
      const r = await c.query<{ sou_admin: boolean }>(
        `SELECT equipe_sou_admin() AS sou_admin`,
      );
      return r.rows[0]?.sou_admin ?? false;
    })) || meusTimes.includes(timeId);

    if (!temPermissao) {
      return NextResponse.json({ error: "acesso negado" }, { status: 404 });
    }

    const timeInfo = pessoas
      .flatMap((p) => p.times ?? [])
      .find((t) => t.id === timeId);

    if (!timeInfo) {
      return NextResponse.json({ error: "time não encontrado" }, { status: 404 });
    }

    // Pessoas do time
    const pessoasDoTime = pessoas.filter((p) => p.times?.some((t) => t.id === timeId));

    // Tarefas do time
    const tarefasPares = await withTenant(user.id, async (c) => {
      const r = await c.query<{ tarefa_id: string; dono_id: string }>(
        `SELECT tarefa_id, dono_id FROM equipe_tarefas_do_time($1)`,
        [timeId],
      );
      return r.rows;
    });

    const tarefas = tarefasPares.length > 0 ? await carregarTarefas(user.id, tarefasPares) : [];

    // Projetos do time
    const projetos = await withTenant(user.id, async (c) => {
      const r = await c.query<{
        id: string;
        nome: string;
        objetivo_id: string | null;
        abertas: number;
        feitas: number;
        vencidas: number;
        proximo_prazo: string | null;
      }>(
        `SELECT q.id, q.nome, q.objetivo_id,
                COUNT(*) FILTER (WHERE t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao')) AS abertas,
                COUNT(*) FILTER (WHERE t.status = 'concluida') AS feitas,
                COUNT(*) FILTER (WHERE t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao')
                                      AND t.prazo < now()::date) AS vencidas,
                TO_CHAR(MIN(CASE WHEN t.status IN ('aberta', 'em_andamento', 'aguardando_aprovacao')
                                  AND t.prazo >= now()::date THEN t.prazo END), 'YYYY-MM-DD') AS proximo_prazo
           FROM quadros q
           LEFT JOIN quadro_tarefas qt ON qt.quadro_id = q.id
           LEFT JOIN tarefas t ON t.id = qt.tarefa_id
          WHERE q.time_id = $1 AND q.archived_at IS NULL
          GROUP BY q.id, q.nome, q.objetivo_id`,
        [timeId],
      );

      // Carregar nomes de objetivos
      const objetivosIds = [...new Set(r.rows.filter((x) => x.objetivo_id).map((x) => x.objetivo_id))];
      const objetivosNomes = new Map<string, string>();
      if (objetivosIds.length > 0) {
        const or = await c.query<{ id: string; nome: string }>(
          `SELECT id, nome FROM objetivos WHERE id = ANY ($1)`,
          [objetivosIds],
        );
        for (const row of or.rows) {
          objetivosNomes.set(row.id, row.nome);
        }
      }

      return r.rows.map((x) => ({
        id: x.id,
        nome: x.nome,
        time_id: timeId,
        time_nome: timeInfo.nome,
        objetivo: x.objetivo_id ? { id: x.objetivo_id, nome: objetivosNomes.get(x.objetivo_id) ?? null } : null,
        abertas: x.abertas,
        feitas: x.feitas,
        vencidas: x.vencidas,
        proximo_prazo: x.proximo_prazo,
      }));
    });

    return NextResponse.json({
      time: { id: timeId, nome: timeInfo.nome, organizacao: pessoasDoTime[0]?.organizacao ?? "" },
      pessoas: pessoasDoTime,
      tarefas,
      projetos,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

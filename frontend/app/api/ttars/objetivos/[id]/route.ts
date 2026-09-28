import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { comoDonoDoObjetivo, objetivosVisiveis, tarefasDoObjetivo, UUID_RE } from "@/lib/hub";
import { lerObjetivo } from "@/lib/objetivos";
import { projetosParaTela } from "@/lib/projetos-tela";
import { paraTela } from "@/lib/ttars-tela";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Um objetivo: os números, os projetos ligados e as ações (ligadas direto ou pelos projetos),
// só o que quem pede enxerga.
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Objetivo não encontrado." }, { status: 404 });
  const [objetivo] = await objetivosVisiveis(user.id, id);
  if (!objetivo) return NextResponse.json({ error: "Objetivo não encontrado." }, { status: 404 });
  const [tarefas, projetosIds] = await Promise.all([
    tarefasDoObjetivo(user.id, id).then((t) => paraTela(user.id, t)),
    withTenant(user.id, (c) => c.query<{ quadro_id: string }>(`SELECT quadro_id FROM equipe_projetos_do_objetivo($1)`, [id])).then((r) =>
      r.rows.map((x) => x.quadro_id),
    ),
  ]);
  return NextResponse.json({ objetivo, tarefas, projetos: await projetosParaTela(user.id, projetosIds) });
});

// Quem enxerga o objetivo muda nome, como medir e prazo; quem vê (e o time) só quem criou.
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  const lido = await lerObjetivo(user.id, b, true);
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const d = lido.dados;
  if (!Object.keys(d).length) return NextResponse.json({ error: "Nada para mudar." }, { status: 400 });
  const r = await comoDonoDoObjetivo(user.id, id, async (c, donoId) => {
    if ((d.visibilidade !== undefined || d.time_id !== undefined) && donoId !== user.id) return "so_dono" as const;
    const atual = (await c.query<{ visibilidade: string; time_id: string | null }>(`SELECT visibilidade, time_id FROM objetivos WHERE id = $1`, [id])).rows[0];
    if (!atual) return "nao_achou" as const;
    const visibilidade = d.visibilidade ?? atual.visibilidade;
    const time = visibilidade === "time" ? (d.time_id !== undefined ? d.time_id : atual.time_id) : null;
    if (visibilidade === "time" && !time) return "sem_time" as const;
    const sets: string[] = [];
    const valores: unknown[] = [];
    const por = (col: string, v: unknown) => {
      valores.push(v);
      sets.push(`${col} = $${valores.length}`);
    };
    if (d.nome !== undefined) por("nome", d.nome);
    if (d.como_medir !== undefined) por("como_medir", d.como_medir);
    if (d.prazo !== undefined) por("prazo", d.prazo);
    if (d.visibilidade !== undefined || d.time_id !== undefined) {
      por("visibilidade", visibilidade);
      por("time_id", time);
    }
    valores.push(id);
    await c.query(`UPDATE objetivos SET ${sets.join(", ")}, updated_at = now() WHERE id = $${valores.length}`, valores);
    return "ok" as const;
  });
  if (!r || r.valor === "nao_achou") return NextResponse.json({ error: "Objetivo não encontrado." }, { status: 404 });
  if (r.valor === "so_dono") return NextResponse.json({ error: "Só quem criou o objetivo muda quem vê." }, { status: 403 });
  if (r.valor === "sem_time") return NextResponse.json({ error: "Escolha o time que vai ver o objetivo." }, { status: 400 });
  return NextResponse.json({ ok: true });
});

// Arquivar: só quem criou. Projetos e ações continuam existindo (só deixam de apontar para ele na tela).
export const DELETE = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const r = await comoDonoDoObjetivo(user.id, id, async (c, donoId) => {
    if (donoId !== user.id) return false;
    await c.query(`UPDATE objetivos SET archived_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return true;
  });
  if (!r) return NextResponse.json({ error: "Objetivo não encontrado." }, { status: 404 });
  if (!r.valor) return NextResponse.json({ error: "Só quem criou o objetivo arquiva." }, { status: 403 });
  return NextResponse.json({ ok: true });
});

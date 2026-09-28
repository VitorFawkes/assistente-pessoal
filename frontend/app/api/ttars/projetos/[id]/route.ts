import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { comoDonoDoProjeto } from "@/lib/equipe-compartilhado";
import { projetoParaQuemVe } from "@/lib/projetos";
import { conexaoAtiva } from "@/lib/notion-sync";
import { nomesDosObjetivos, nomesDosTimes, podeObjetivo, podeTime, timeIdValido } from "@/lib/hub";
import { paraTela } from "@/lib/ttars-tela";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// O projeto inteiro como quem pede enxerga (ações de todos, cada uma do ponto de vista dele),
// com o time e o objetivo.
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const p = await projetoParaQuemVe(user.id, id);
  if (!p) return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  const q = p.quadro;
  const [tarefas, conexao, objetivos, times] = await Promise.all([
    paraTela(user.id, p.tarefas),
    conexaoAtiva(),
    nomesDosObjetivos(user.id, q.objetivo_id ? [q.objetivo_id] : []),
    q.time_id ? nomesDosTimes() : Promise.resolve(new Map<string, string>()),
  ]);
  const objetivoNome = q.objetivo_id ? objetivos.get(q.objetivo_id) : undefined;
  return NextResponse.json({
    projeto: {
      id: q.id,
      nome: q.nome,
      descricao: q.descricao ?? null,
      criado_em: q.created_at,
      time_id: q.time_id ?? null,
      time_nome: q.time_id ? (times.get(q.time_id) ?? null) : null,
      objetivo: q.objetivo_id && objetivoNome ? { id: q.objetivo_id, nome: objetivoNome } : null,
    },
    sou_dono: p.sou_dono,
    // O projeto que espelha o Notion do marketing (quem criou é a "pessoa" do Notion).
    do_notion: !!conexao && conexao.quadro_id === q.id,
    notion_atualizado_em: conexao && conexao.quadro_id === q.id ? conexao.ultima_rodada : null,
    pessoas: p.pessoas,
    tarefas,
    atividade: p.atividade.slice(0, 20),
  });
});

// Liga o projeto a um time (todo mundo do time entra; só quem criou o projeto muda) e a um
// objetivo (quem está no projeto e enxerga o objetivo).
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { time_id?: unknown; objetivo_id?: unknown } | null;
  if (!body || (body.time_id === undefined && body.objetivo_id === undefined)) {
    return NextResponse.json({ error: "Nada para mudar." }, { status: 400 });
  }
  if (body.time_id !== undefined && body.time_id !== null && !(timeIdValido(body.time_id) && (await podeTime(user.id, body.time_id)))) {
    return NextResponse.json({ error: "Você não está nesse time." }, { status: 400 });
  }
  if (body.objetivo_id !== undefined && body.objetivo_id !== null && !(typeof body.objetivo_id === "string" && (await podeObjetivo(user.id, body.objetivo_id)))) {
    return NextResponse.json({ error: "Esse objetivo não existe ou você não o enxerga." }, { status: 400 });
  }
  const r = await comoDonoDoProjeto(user.id, id, async (c, donoId) => {
    if (body.time_id !== undefined && donoId !== user.id) return "so_dono" as const;
    const sets: string[] = [];
    const valores: unknown[] = [];
    if (body.time_id !== undefined) {
      valores.push(body.time_id);
      sets.push(`time_id = $${valores.length}`);
    }
    if (body.objetivo_id !== undefined) {
      valores.push(body.objetivo_id);
      sets.push(`objetivo_id = $${valores.length}`);
    }
    valores.push(id);
    await c.query(`UPDATE quadros SET ${sets.join(", ")}, updated_at = now() WHERE id = $${valores.length}`, valores);
    return "ok" as const;
  });
  if (!r) return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  if (r.valor === "so_dono") return NextResponse.json({ error: "Só quem criou o projeto muda o time dele." }, { status: 403 });
  return NextResponse.json({ ok: true });
});

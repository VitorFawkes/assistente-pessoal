import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { projetoParaQuemVe } from "@/lib/projetos";
import { meetingSubject } from "@/lib/meeting-label";
import { conexaoAtiva, notionDasAcoes } from "@/lib/notion-sync";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

type PatchBody = {
  time_id?: string | null;
  objetivo_id?: string | null;
};

// O projeto inteiro como quem pede enxerga (ações de todos, cada uma do ponto de vista dele).
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const p = await projetoParaQuemVe(user.id, id);
  if (!p) return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  const [notion, conexao] = await Promise.all([notionDasAcoes(p.tarefas.map((t) => t.id)), conexaoAtiva()]);
  return NextResponse.json({
    projeto: { id: p.quadro.id, nome: p.quadro.nome, descricao: p.quadro.descricao ?? null, criado_em: p.quadro.created_at },
    sou_dono: p.sou_dono,
    // O projeto que espelha o Notion do marketing (quem criou é a "pessoa" do Notion).
    do_notion: !!conexao && conexao.quadro_id === p.quadro.id,
    notion_atualizado_em: conexao && conexao.quadro_id === p.quadro.id ? conexao.ultima_rodada : null,
    pessoas: p.pessoas,
    tarefas: p.tarefas.map((t) => ({
      ...t,
      reuniao_rotulo: t.meeting_id ? meetingSubject(t.meeting_summary, t.meeting_nome) || "Reunião" : null,
      notion: notion.get(t.id) ?? null,
    })),
    atividade: p.atividade.slice(0, 20),
  });
});

export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  try {
    const { id } = await ctx.params;
    const body: PatchBody = await req.json();

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    // Verificar que o projeto existe e o usuário pode vê-lo
    const p = await projetoParaQuemVe(user.id, id);
    if (!p) {
      return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
    }

    if (body.time_id && !body.time_id.match(/^t-[a-z0-9-]+$/i)) {
      return NextResponse.json({ error: "time_id inválido" }, { status: 400 });
    }

    if (body.objetivo_id && !UUID_RE.test(body.objetivo_id)) {
      return NextResponse.json({ error: "objetivo_id inválido" }, { status: 400 });
    }

    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
    }

    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.time_id !== undefined) {
      sets.push(`time_id = $${values.length + 1}`);
      values.push(body.time_id ?? null);
    }

    if (body.objetivo_id !== undefined) {
      sets.push(`objetivo_id = $${values.length + 1}`);
      values.push(body.objetivo_id ?? null);
    }

    values.push(id);

    await withTenant(user.id, async (c) => {
      await c.query(
        `UPDATE quadros SET ${sets.join(", ")} WHERE id = $${values.length}`,
        values,
      );
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});

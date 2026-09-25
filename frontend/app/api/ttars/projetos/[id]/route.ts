import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { projetoParaQuemVe } from "@/lib/projetos";
import { meetingSubject } from "@/lib/meeting-label";
import { conexaoAtiva, notionDasAcoes } from "@/lib/notion-sync";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

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

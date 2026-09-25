import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { projetoParaQuemVe } from "@/lib/projetos";
import { meetingSubject } from "@/lib/meeting-label";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// O projeto inteiro como quem pede enxerga (ações de todos, cada uma do ponto de vista dele).
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const p = await projetoParaQuemVe(user.id, id);
  if (!p) return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  return NextResponse.json({
    projeto: { id: p.quadro.id, nome: p.quadro.nome, descricao: p.quadro.descricao ?? null, criado_em: p.quadro.created_at },
    sou_dono: p.sou_dono,
    pessoas: p.pessoas,
    tarefas: p.tarefas.map((t) => ({
      ...t,
      reuniao_rotulo: t.meeting_id ? meetingSubject(t.meeting_summary, t.meeting_nome) || "Reunião" : null,
    })),
    atividade: p.atividade.slice(0, 20),
  });
});

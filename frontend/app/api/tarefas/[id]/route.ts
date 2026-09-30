import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { isTeamMode } from "@/lib/team-mode";
import { acessoTarefa, carregarTarefas } from "@/lib/equipe-compartilhado";
import { semObjetivoEscondido } from "@/lib/hub";
import { mudarTarefa, type MudancaDeTarefa } from "@/lib/tarefa-mudar";
import { travaDoPedido } from "@/lib/pedidos-trava";

type Ctx = { params: Promise<{ id: string }> };

// A regra de mudar tarefa mora em lib/tarefa-mudar.ts (o Coach usa a mesma).
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  let body: MudancaDeTarefa;
  try {
    body = (await (req as NextRequest).json()) as MudancaDeTarefa;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const r = await mudarTarefa(user, id, body);
  return NextResponse.json(r.json, { status: r.status });
});

export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  // Equipe: quem recebeu de colega ou vê pelo projeto lê a tarefa do ponto de vista dele.
  if (isTeamMode()) {
    const acesso = await acessoTarefa(user.id, id);
    if (acesso && acesso.papel !== "dono") {
      const [visto] = await carregarTarefas(user.id, [{ tarefa_id: id, dono_id: acesso.donoId }]);
      return visto ? NextResponse.json(await semObjetivoEscondido(user.id, visto)) : NextResponse.json({ error: "não encontrada" }, { status: 404 });
    }
  }
  const rows = await withTenant(user.id, async (db) => {
    const r = await db.query("SELECT * FROM tarefas WHERE id = $1", [id]);
    return r.rows;
  });
  if (!rows.length) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  return NextResponse.json(await semObjetivoEscondido(user.id, rows[0] as { objetivo_id?: string | null }));
});

export const DELETE = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  // Equipe: só quem criou apaga. Quem recebeu de colega ou vê pelo projeto pode tirar do
  // projeto ou devolver, mas não some com o trabalho de outra pessoa.
  if (isTeamMode()) {
    const acesso = await acessoTarefa(user.id, id);
    if (!acesso) return NextResponse.json({ error: "tarefa não encontrada" }, { status: 404 });
    if (acesso.papel !== "dono") {
      return NextResponse.json(
        { error: "Só quem criou a tarefa pode apagar. Você pode tirar ela do projeto." },
        { status: 403 },
      );
    }
  }
  // Pedido ao marketing: quem pediu apaga só enquanto o marketing não começou.
  const trava = await travaDoPedido(user.id, [id], { apagar: true });
  if (trava) return NextResponse.json({ error: trava.erro }, { status: trava.status });
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

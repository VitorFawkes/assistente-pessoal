import { type NextRequest, NextResponse } from "next/server";
import { incorporarTarefas, type TarefaExtraida } from "@/lib/tarefas-repetidas-db";
import { withUsageContext } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";
// 3 leituras da IA em paralelo + gravação: folga pro n8n não cortar no meio.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

type Body = {
  user_id?: string;
  meeting_id?: string;
  tarefas?: TarefaExtraida[];
  reprocessar?: boolean;
};

/**
 * POST /api/admin/tarefas/incorporar — o n8n entrega as tarefas extraídas de
 * uma reunião; aqui elas são comparadas com as que já existem antes de nascer
 * (lib/tarefas-repetidas-db.ts). Substitui o INSERT direto dos 4 workflows.
 * Auth: x-admin-token = WEBHOOK_TOKEN (mesmo segredo do reset-meeting).
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("x-admin-token") || "";
  if (!WEBHOOK_TOKEN || auth !== WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const meetingId = typeof body.meeting_id === "string" ? body.meeting_id : "";
  if (!UUID_RE.test(userId) || !UUID_RE.test(meetingId)) {
    return NextResponse.json({ error: "user_id e meeting_id obrigatórios" }, { status: 400 });
  }
  const tarefas = Array.isArray(body.tarefas) ? body.tarefas : [];
  try {
    const r = await withUsageContext({ userId, meetingId }, () => incorporarTarefas({ userId, meetingId, tarefas, reprocessar: body.reprocessar === true }));
    console.log(
      `[tarefas-repetidas] reunião ${meetingId}: ${r.criadas.length} criadas, ${r.juntadas.length} juntadas, ` +
        `${r.substituidas.length} substituídas, ${r.ignoradas} ignoradas (${r.comparacao})`,
    );
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[tarefas-repetidas] incorporar falhou:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

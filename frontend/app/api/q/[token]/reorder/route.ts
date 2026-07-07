import { type NextRequest, NextResponse } from "next/server";
import { withGuest, guestErrorResponse } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string }> };

/**
 * POST /api/q/[token]/reorder — o convidado reordena as tarefas do quadro
 * (visão timeline "por tarefa"): grava quadro_tarefas.ordem na ordem recebida.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids_vazio" }, { status: 400 });
  }

  try {
    await withGuest(token, ip, async ({ acesso, c }) => {
      await c.query(
        `UPDATE quadro_tarefas qt
            SET ordem = (u.idx - 1) * 10
           FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, idx)
          WHERE qt.quadro_id = $1 AND qt.tarefa_id = u.id`,
        [acesso.quadroId, ids],
      );
    });
    return NextResponse.json({ ok: true, count: ids.length });
  } catch (e) {
    return guestErrorResponse(e);
  }
}

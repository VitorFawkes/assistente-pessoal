import { type NextRequest, NextResponse } from "next/server";
import { withGuest, guestErrorResponse } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string }> };

/**
 * PATCH /api/q/[token] — o convidado edita o próprio quadro:
 * nome, descrição e vista_padrao (Lista/Linha do tempo).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  let body: Partial<{ nome: string; descricao: string | null; vista_padrao: string }>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (
    body.vista_padrao !== undefined &&
    body.vista_padrao !== "lista" &&
    body.vista_padrao !== "timeline"
  ) {
    return NextResponse.json({ error: "vista_padrao inválida" }, { status: 400 });
  }

  try {
    const result = await withGuest(token, ip, async ({ acesso, c }) => {
      const sets: string[] = [];
      const vals: unknown[] = [];
      const push = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };

      if (body.nome !== undefined) {
        const n = String(body.nome).trim();
        if (n) push("nome", n);
      }
      if (body.descricao !== undefined) push("descricao", body.descricao || null);
      if (body.vista_padrao !== undefined) push("vista_padrao", body.vista_padrao);

      if (!sets.length) throw new Error("nothing_to_update");
      sets.push("updated_at = now()");
      vals.push(acesso.quadroId);

      const { rows } = await c.query(
        `UPDATE quadros SET ${sets.join(", ")}
          WHERE id = $${vals.length}
          RETURNING id, nome, descricao, vista_padrao`,
        vals,
      );
      return rows[0];
    });

    return NextResponse.json(result);
  } catch (e) {
    return guestErrorResponse(e);
  }
}

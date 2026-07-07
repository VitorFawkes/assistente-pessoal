import { type NextRequest, NextResponse } from "next/server";
import { withGuest, guestErrorResponse } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/q/[token]/pessoas — lista as pessoas do dono (para os popovers de
 * atribuição na timeline). Espelha /api/q/[token]/frentes; mesmo trade-off de
 * expor a lista do dono ao convidado (aceito, como as frentes).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  try {
    const result = await withGuest(token, ip, async ({ c }) => {
      const r = await c.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM pessoas ORDER BY nome`,
      );
      return { pessoas: r.rows };
    });
    return NextResponse.json(result);
  } catch (e) {
    return guestErrorResponse(e);
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { withGuest, guestErrorResponse } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string; gid: string }> };

/**
 * DELETE /api/q/[token]/convidados/[gid] — o convidado revoga outro convidado
 * do MESMO quadro (soft delete via revoked_at). Escopado ao quadro do token.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { token, gid } = await ctx.params;
  const ip = clientIp(req.headers);
  try {
    await withGuest(token, ip, async ({ acesso, c }) => {
      await c.query(
        `UPDATE quadro_convidados SET revoked_at = now()
          WHERE id = $1 AND quadro_id = $2`,
        [gid, acesso.quadroId],
      );
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return guestErrorResponse(e);
  }
}

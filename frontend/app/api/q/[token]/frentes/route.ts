import { type NextRequest, NextResponse } from "next/server";
import { withGuest, GuestError } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/q/[token]/frentes
 * Lista áreas (frentes) disponíveis ao convidado do dono.
 * Retorna { frentes: [{ id, nome }, ...] }
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  try {
    const result = await withGuest(token, ip, async ({ acesso, c }) => {
      // Query frentes do dono NO MESMO client (RLS escopado ao tenant)
      const frentesResult = await c.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM frentes WHERE user_id = $1 AND ativo ORDER BY ordem, nome`,
        [acesso.ownerId]
      );

      return {
        frentes: frentesResult.rows,
      };
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GuestError) {
      if (e.code === "rate_limit") {
        return NextResponse.json(
          { error: "rate_limit_exceeded", message: "Muitas requisições. Aguarde 1 minuto." },
          { status: 429, headers: { "Retry-After": "60" } }
        );
      }
      return NextResponse.json(
        { error: "invalid_token", message: "Link inválido ou revogado." },
        { status: 401 }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

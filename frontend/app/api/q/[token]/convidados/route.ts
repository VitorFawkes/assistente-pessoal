import { type NextRequest, NextResponse } from "next/server";
import { withGuest, guestErrorResponse } from "@/lib/quadro-guest";
import { clientIp } from "@/lib/rate-limit";
import { randomBytes } from "node:crypto";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/q/[token]/convidados — lista os convidados ativos do quadro.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);
  try {
    const result = await withGuest(token, ip, async ({ acesso, c }) => {
      const r = await c.query(
        `SELECT id, nome, token, created_at, last_seen_at
           FROM quadro_convidados
          WHERE quadro_id = $1 AND revoked_at IS NULL
          ORDER BY created_at DESC`,
        [acesso.quadroId],
      );
      return { convidados: r.rows };
    });
    return NextResponse.json(result);
  } catch (e) {
    return guestErrorResponse(e);
  }
}

/**
 * POST /api/q/[token]/convidados — o convidado cria novos convidados do quadro.
 * `{ nome }` cria um; `{ nomes: [...] }` cria em lote (até 100, dedup, sem vazios).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = clientIp(req.headers);

  let body: { nome?: string; nomes?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await withGuest(token, ip, async ({ acesso, c }) => {
      if (Array.isArray(body.nomes)) {
        const limpos = [
          ...new Set(body.nomes.map((n) => String(n).trim()).filter((n) => n.length > 0)),
        ].slice(0, 100);
        if (limpos.length === 0) return { convidados: [] };
        const tokens = limpos.map(() => randomBytes(16).toString("base64url"));
        const r = await c.query(
          `INSERT INTO quadro_convidados (quadro_id, nome, token)
           SELECT $1, nome, tk FROM unnest($2::text[], $3::text[]) AS t(nome, tk)
           RETURNING id, nome, token`,
          [acesso.quadroId, limpos, tokens],
        );
        return { convidados: r.rows };
      }
      const nome = String(body.nome || "").trim();
      if (!nome) throw new Error("nome_required");
      const tk = randomBytes(16).toString("base64url");
      const r = await c.query(
        `INSERT INTO quadro_convidados (quadro_id, nome, token)
         VALUES ($1, $2, $3) RETURNING id, nome, token`,
        [acesso.quadroId, nome, tk],
      );
      return r.rows[0];
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return guestErrorResponse(e);
  }
}

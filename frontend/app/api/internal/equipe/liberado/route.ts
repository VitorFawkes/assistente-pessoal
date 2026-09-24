import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const TTARS_ROSTER_TOKEN = process.env.TTARS_ROSTER_TOKEN || "";

export async function POST(req: NextRequest) {
  // Rate-limit: 30 requisições por minuto por IP
  const ip = clientIp(req.headers);
  if (!rateLimit(`equipe-liberado:${ip}`, 30, 60_000)) {
    return new NextResponse("too many requests", { status: 429 });
  }

  // Autenticação: APENAS TTARS_ROSTER_TOKEN (nunca SSO_SECRET)
  const token = Buffer.from(req.headers.get("x-acoes-token") ?? "");
  const esperado = Buffer.from(TTARS_ROSTER_TOKEN);
  if (!TTARS_ROSTER_TOKEN || token.length !== esperado.length || !timingSafeEqual(token, esperado)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const email = (body.email || "").toString().toLowerCase().trim();

  if (!email) {
    return new NextResponse("missing email", { status: 400 });
  }

  try {
    const rows = await query<{ liberado: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM acessos_equipe WHERE email = $1 AND liberado)
         OR EXISTS (SELECT 1 FROM users WHERE LOWER(email) = $1 AND is_admin AND deleted_at IS NULL)
       ) AS liberado`,
      [email],
    );

    const liberado = rows[0]?.liberado === true;
    return NextResponse.json({ liberado });
  } catch (err) {
    console.error("[equipe/liberado] erro", err);
    return new NextResponse("internal error", { status: 500 });
  }
}

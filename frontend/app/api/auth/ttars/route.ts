import { NextRequest, NextResponse } from "next/server";
import { validateTtarsSsoToken, upsertUserFromTtars, TtarsSsoError } from "@/lib/ttars-sso";
import { setSessionCookie } from "@/lib/auth";
import { query } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const token = searchParams.get("t");

  if (!token) {
    return new NextResponse("missing token", { status: 400 });
  }

  try {
    // Validar token do TTARS
    const claims = await validateTtarsSsoToken(token);

    // Criar ou atualizar user
    const user = await upsertUserFromTtars(claims);

    // Criar sessão
    const ip = clientIp(req.headers);
    const sessionRows = await query<{ id: string }>(
      `INSERT INTO sessions (user_id, ip_address, user_agent)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        user.id,
        ip === "unknown" ? null : ip,
        (req.headers.get("user-agent") || "").slice(0, 500),
      ],
    );

    const sessionId = sessionRows[0].id;

    // Audit log
    await query(
      `INSERT INTO audit_log (user_id, action, metadata)
       VALUES ($1, 'ttars.login', $2)`,
      [user.id, JSON.stringify({ ttars_user_id: claims.ttars_user_id, times: claims.times })],
    );

    // Setar cookie de sessão
    await setSessionCookie(sessionId);

    // Redirecionar para /termos se não aceitou, senão para /
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
    const nextUrl = searchParams.get("next") || "/";
    const redirectUrl = `${proto}://${host}${nextUrl}`;

    return NextResponse.redirect(redirectUrl, 303);
  } catch (e) {
    if (e instanceof TtarsSsoError) {
      // Email não autorizado → /sem-acesso
      if (e.code === "email_not_authorized") {
        const proto = req.headers.get("x-forwarded-proto") || "https";
        const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
        return NextResponse.redirect(`${proto}://${host}/sem-acesso`, 303);
      }

      // Outros erros de validação → 400
      console.error(`[TTARS SSO] ${e.code}: ${e.message}`);
      return new NextResponse(`${e.code}: ${e.message}`, { status: 400 });
    }

    console.error("[TTARS SSO] erro inesperado", e);
    throw e;
  }
}

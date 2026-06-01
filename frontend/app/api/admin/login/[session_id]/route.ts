import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ session_id: string }> },
) {
  const { session_id } = await ctx.params;
  if (!UUID_RE.test(session_id)) {
    return NextResponse.json({ error: "session_id inválido" }, { status: 400 });
  }

  const rows = await query<{ id: string; user_id: string; revoked_at: string | null }>(
    `SELECT id, user_id, revoked_at FROM sessions WHERE id = $1`,
    [session_id],
  );
  if (rows.length === 0 || rows[0].revoked_at) {
    return NextResponse.json({ error: "session inválida ou revogada" }, { status: 404 });
  }

  // Atualiza last_used_at pra reset do TTL
  await query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [session_id]);

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";

  // Aceita ?next=/algum/path pra abrir uma rota específica pós-login (ex: app
  // iOS tap em meeting → bridge auth → /reunioes/<id>). Validamos que é path
  // relativo começando com '/' pra prevenir open redirect.
  const rawNext = req.nextUrl.searchParams.get("next");
  const safePath =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/";

  const res = NextResponse.redirect(`${proto}://${host}${safePath}`, 303);
  res.cookies.set("session", session_id, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 dias
  });
  return res;
}

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// Em Next.js 16, proxy roda em Node.js runtime por padrão (mudou em relação
// ao middleware do 15 que era Edge). Permite acesso direto ao pg.

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|api/health|api/save-audio).*)"],
};

const PUBLIC_PREFIXES = ["/c/", "/sem-acesso", "/termos"];
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionId = req.cookies.get("session")?.value;
  if (!sessionId) {
    return NextResponse.redirect(new URL("/sem-acesso", req.url));
  }

  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  try {
    const rows = await query<{ exists: boolean; consent_terms_at: string | null }>(
      `SELECT
         (s.id IS NOT NULL) AS exists,
         u.consent_terms_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1
         AND s.revoked_at IS NULL
         AND s.last_used_at > $2
         AND u.deleted_at IS NULL`,
      [sessionId, cutoff],
    );
    const row = rows[0];
    if (!row?.exists) {
      const res = NextResponse.redirect(new URL("/sem-acesso", req.url));
      res.cookies.delete("session");
      return res;
    }

    // Força aceite dos termos antes do app
    if (!row.consent_terms_at && pathname !== "/termos" && !pathname.startsWith("/api/sessao")) {
      return NextResponse.redirect(new URL("/termos", req.url));
    }
  } catch (err) {
    console.error("proxy: erro validando sessão", err);
    return NextResponse.redirect(new URL("/sem-acesso", req.url));
  }

  return NextResponse.next();
}

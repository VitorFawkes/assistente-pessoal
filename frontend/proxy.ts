import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// Em Next.js 16, proxy roda em Node.js runtime por padrão (mudou em relação
// ao middleware do 15 que era Edge). Permite acesso direto ao pg.

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|api/health|api/save-audio|\\.well-known).*)"],
};

const PUBLIC_PREFIXES = [
  "/c/",                  // página de convite (consume)
  "/sem-acesso",
  "/api/sessao",          // POST consume invite (cria sessão), DELETE logout
  "/api/admin/",          // rotas admin têm auth própria via x-admin-token (WEBHOOK_TOKEN)
  "/api/auth/mobile/",    // app iOS: exchange invite/session → access_token (auth própria via body)
  "/api/mobile/",         // app iOS: rotas autenticadas via Authorization: Bearer (auth própria na rota)
  "/api/agent/",          // chat-bridge (Bearer) + Hermes (X-API-Key) — auth própria na rota (withAgentAuth)
  "/api/internal/",       // service-to-service (ingest-svc valida session com INTERNAL_SVC_TOKEN)
  // atalho de login só em dev (rota é NODE_ENV-gated; em prod nem entra aqui)
  ...(process.env.NODE_ENV !== "production" ? ["/api/dev-login"] : []),
];
// /termos é semi-público: precisa de sessão, mas SEM consent_terms_at.
// Tratado inline abaixo, não no PUBLIC_PREFIXES.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Service-to-service auth: voice-svc/n8n acessam APIs internas com
  // X-Webhook-Token + X-User-Id. A rota destino valida os headers de novo
  // (defesa em profundidade); aqui só evitamos o redirect pra /sem-acesso.
  if (WEBHOOK_TOKEN) {
    const token = req.headers.get("x-webhook-token");
    if (token && token === WEBHOOK_TOKEN) {
      return NextResponse.next();
    }
  }

  const sessionId = req.cookies.get("session")?.value;
  if (!sessionId) {
    // /termos requer sessão (mas não consent). Sem sessão → /sem-acesso.
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

    // Força aceite dos termos antes do app (exceto /termos e /api/termos)
    if (!row.consent_terms_at && pathname !== "/termos") {
      return NextResponse.redirect(new URL("/termos", req.url));
    }
  } catch (err) {
    console.error("proxy: erro validando sessão", err);
    return NextResponse.redirect(new URL("/sem-acesso", req.url));
  }

  return NextResponse.next();
}

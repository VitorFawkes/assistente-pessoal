import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isTeamMode } from "@/lib/team-mode";
import { COOKIE_SESSAO, opcoesCookieSessao, origensQuePodemEmbutir } from "@/lib/cookie-sessao";

// Em Next.js 16, proxy roda em Node.js runtime por padrão (mudou em relação
// ao middleware do 15 que era Edge). Permite acesso direto ao pg.

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|api/health|api/save-audio|\\.well-known).*)"],
};

const PUBLIC_PREFIXES = [
  "/c/",                  // página de convite (consume)
  "/privacidade",         // política de privacidade (sem login)
  "/sem-acesso",
  "/api/sessao",          // POST consume invite (cria sessão), DELETE logout
  "/api/auth/",           // login externo (ttars, mobile, etc) — auth própria por rota
  "/api/admin/",          // rotas admin têm auth própria via x-admin-token (WEBHOOK_TOKEN)
  "/api/auth/mobile/",    // app iOS: exchange invite/session → access_token (auth própria via body)
  "/api/mobile/",         // app iOS: rotas autenticadas via Authorization: Bearer (auth própria na rota)
  "/api/agent/",          // chat-bridge (Bearer) + Hermes (X-API-Key) — auth própria na rota (withAgentAuth)
  "/api/internal/",       // service-to-service (ingest-svc valida session com INTERNAL_SVC_TOKEN)
  "/q/",                  // página pública do quadro por token (guest)
  "/api/q/",              // APIs públicas do quadro por token (guest, rate-limit + token validation)
  "/r/",                  // página pública da reunião por token (leitura + download)
  "/api/r/",              // download da reunião por token (rate-limit + token validation)
  // atalho de login só em dev (rota é NODE_ENV-gated; em prod nem entra aqui)
  ...(process.env.NODE_ENV !== "production" ? ["/api/dev-login"] : []),
];
// /termos é semi-público: precisa de sessão, mas SEM consent_terms_at.
// Tratado inline abaixo, não no PUBLIC_PREFIXES.
// Modo equipe: só o admin abre estas áreas (páginas e APIs).
// Projetos (/quadros) são de todos na equipe: o acesso a cada um é conferido no banco.
const SO_ADMIN_NA_EQUIPE = ["/plano", "/coach", "/assistente", "/admin", "/api/coach", "/api/agent"];
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

// Equipe: o Ações abre dentro do TTARS. Só as páginas do próprio Ações e as do TTARS podem
// mostrá-lo num quadro — nenhum outro site (evita alguém esconder o Ações atrás de outra tela).
function comMoldura(res: NextResponse): NextResponse {
  if (isTeamMode()) {
    res.headers.set(
      "Content-Security-Policy",
      ["frame-ancestors 'self'", ...origensQuePodemEmbutir()].join(" "),
    );
  }
  return res;
}

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Equipe: o cookie de sessão vai também pra dentro do TTARS (SameSite=None), então pedido
  // que muda algo e vem de OUTRO site com a sessão é recusado. O próprio Ações (mesmo dentro
  // do TTARS) chama como "same-origin"; o app do iPhone não manda Sec-Fetch-Site.
  if (
    isTeamMode() &&
    !METODOS_SEGUROS.has(req.method) &&
    req.headers.get("sec-fetch-site") === "cross-site" &&
    req.cookies.get(COOKIE_SESSAO)?.value &&
    !pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.json({ error: "pedido de outro site recusado" }, { status: 403 });
  }

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return comMoldura(NextResponse.next());
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
    return comMoldura(NextResponse.redirect(new URL("/sem-acesso", req.url)));
  }

  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  try {
    const rows = await query<{ exists: boolean; consent_terms_at: string | null; is_admin: boolean }>(
      `SELECT
         (s.id IS NOT NULL) AS exists,
         u.consent_terms_at,
         u.is_admin
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
      res.cookies.set(COOKIE_SESSAO, "", opcoesCookieSessao(0));
      return comMoldura(res);
    }

    // Força aceite dos termos antes do app (exceto /termos e /api/termos)
    if (!row.consent_terms_at && pathname !== "/termos") {
      return NextResponse.redirect(new URL("/termos", req.url));
    }

    if (
      isTeamMode() &&
      !row.is_admin &&
      SO_ADMIN_NA_EQUIPE.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ) {
      return pathname.startsWith("/api/")
        ? NextResponse.json({ error: "forbidden" }, { status: 403 })
        : NextResponse.redirect(new URL("/", req.url));
    }
  } catch (err) {
    console.error("proxy: erro validando sessão", err);
    return NextResponse.redirect(new URL("/sem-acesso", req.url));
  }

  // Renova o cookie a cada request válido. O TTL do lado do servidor já é
  // deslizante (last_used_at), mas o cookie era gravado só no login com
  // 30 dias fixos — então o navegador descartava a sessão 30 dias depois
  // de entrar, mesmo em uso diário, e caía em /sem-acesso.
  const res = NextResponse.next();
  res.cookies.set(COOKIE_SESSAO, sessionId, opcoesCookieSessao(SESSION_TTL_MS / 1000));
  return comMoldura(res);
}

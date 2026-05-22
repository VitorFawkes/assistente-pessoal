import { NextRequest, NextResponse } from "next/server";
import {
  consumeInvite,
  destroySession,
  setSessionCookie,
  getCurrentSessionId,
  InviteError,
} from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`sessao:${ip}`, 5, 60_000)) {
    return new NextResponse("rate limit", { status: 429 });
  }

  // Aceita JSON ou form-encoded (form POST nativo de /c/[code])
  const contentType = req.headers.get("content-type") || "";
  let code: string | undefined;
  let nome: string | undefined;
  if (contentType.includes("application/json")) {
    const body = await req.json();
    code = body.code;
    nome = body.nome;
  } else {
    const form = await req.formData();
    code = form.get("code")?.toString();
    nome = form.get("nome")?.toString();
  }

  if (!code || !nome || nome.trim().length < 2) {
    return new NextResponse("invalid", { status: 400 });
  }

  try {
    const { sessionId } = await consumeInvite(
      code,
      nome.trim(),
      ip === "unknown" ? null : ip,
      req.headers.get("user-agent") || "",
    );
    await setSessionCookie(sessionId);
  } catch (e) {
    if (e instanceof InviteError) {
      return new NextResponse(e.message, { status: 409 });
    }
    throw e;
  }

  // Proxy redireciona pra /termos se consent_terms_at IS NULL.
  // Construímos a URL externa via headers (req.url retorna URL interna do
  // container easypanel = http://0.0.0.0:3000 → chrome-error em redirect).
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
  return NextResponse.redirect(`${proto}://${host}/`, 303);
}

export async function DELETE() {
  const sessionId = await getCurrentSessionId();
  if (sessionId) await destroySession(sessionId);
  return new NextResponse(null, { status: 204 });
}

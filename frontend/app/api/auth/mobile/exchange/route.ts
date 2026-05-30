import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  consumeInvite,
  getUserBySessionId,
  InviteError,
  type User,
} from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

type ExchangeBody =
  | { invite_code: string; nome: string }
  | { session_token: string };

function userPublicFields(u: User) {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    whatsapp: u.whatsapp,
    is_admin: u.is_admin,
    consent_terms_at: u.consent_terms_at,
  };
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`mobile-exchange:${ip}`, 5, 60_000)) {
    return new NextResponse("rate limit", { status: 429 });
  }

  let body: ExchangeBody;
  try {
    body = (await req.json()) as ExchangeBody;
  } catch {
    return new NextResponse("invalid body", { status: 400 });
  }

  // Path 1: refresh — re-valida session_token existente
  if ("session_token" in body && typeof body.session_token === "string") {
    const user = await getUserBySessionId(body.session_token);
    if (!user) return new NextResponse("invalid session", { status: 401 });

    await query(
      `INSERT INTO audit_log (user_id, action, target_id, metadata)
       VALUES ($1, 'mobile.refresh', $2, $3)`,
      [
        user.id,
        body.session_token,
        JSON.stringify({ ip, user_agent: req.headers.get("user-agent") || "" }),
      ],
    );

    return NextResponse.json({
      access_token: body.session_token,
      user: userPublicFields(user),
    });
  }

  // Path 2: primeira troca — consome invite + cria session
  if (
    "invite_code" in body &&
    typeof body.invite_code === "string" &&
    typeof body.nome === "string" &&
    body.nome.trim().length >= 2
  ) {
    try {
      const { user, sessionId } = await consumeInvite(
        body.invite_code,
        body.nome.trim(),
        ip === "unknown" ? null : ip,
        req.headers.get("user-agent") || "ios-app",
      );

      await query(
        `INSERT INTO audit_log (user_id, action, target_id, metadata)
         VALUES ($1, 'mobile.login', $2, $3)`,
        [
          user.id,
          sessionId,
          JSON.stringify({
            ip,
            user_agent: req.headers.get("user-agent") || "",
            via: "invite",
          }),
        ],
      );

      return NextResponse.json({
        access_token: sessionId,
        user: userPublicFields(user),
      });
    } catch (e) {
      if (e instanceof InviteError) {
        return new NextResponse(e.message, { status: 409 });
      }
      throw e;
    }
  }

  return new NextResponse("invalid body", { status: 400 });
}

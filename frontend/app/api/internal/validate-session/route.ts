import { NextRequest, NextResponse } from "next/server";
import { getUserBySessionId } from "@/lib/auth";

/**
 * Service-to-service: valida session token e retorna user_id.
 * Usado pelo ingest-svc quando recebe upload com Authorization: Bearer
 * (em vez do antigo X-Auth estático + X-User-Id explícito).
 *
 * Auth: header X-Internal-Token = INTERNAL_SVC_TOKEN env (shared secret).
 */
export async function GET(req: NextRequest) {
  const expected = process.env.INTERNAL_SVC_TOKEN || "";
  const provided = req.headers.get("x-internal-token") || "";

  if (!expected || provided !== expected) {
    return new NextResponse(null, { status: 401 });
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return new NextResponse("missing token", { status: 400 });
  }

  const user = await getUserBySessionId(token);
  if (!user) {
    return new NextResponse(null, { status: 401 });
  }

  return NextResponse.json({
    user_id: user.id,
    nome: user.nome,
    consent_terms_at: user.consent_terms_at,
  });
}

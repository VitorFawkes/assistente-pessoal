import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Atalho APENAS de desenvolvimento: o app só loga via convite (sem senha), então
// pra abrir localmente sem fricção este endpoint adota a sessão válida mais recente
// (ou ?sid=...) e redireciona pra /plano. Inerte em produção (NODE_ENV=production).
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("not found", { status: 404 });
  }
  const sid = new URL(req.url).searchParams.get("sid");
  let sessionId = sid;
  if (!sessionId) {
    const rows = await query<{ id: string }>(
      `SELECT s.id
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.revoked_at IS NULL AND u.deleted_at IS NULL
        ORDER BY s.last_used_at DESC
        LIMIT 1`,
    );
    sessionId = rows[0]?.id ?? null;
  }
  if (!sessionId) {
    return new NextResponse("nenhuma sessão válida encontrada", { status: 404 });
  }
  await setSessionCookie(sessionId);
  return NextResponse.redirect(new URL("/plano", req.url));
}

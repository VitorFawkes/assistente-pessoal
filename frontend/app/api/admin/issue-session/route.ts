import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

type Body = {
  user_id?: string;
  email?: string;
};

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("x-admin-token") || "";
  if (!WEBHOOK_TOKEN || authHeader !== WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  let userId = typeof body.user_id === "string" && UUID_RE.test(body.user_id)
    ? body.user_id
    : "";

  if (!userId) {
    const r = await query<{ id: string }>(
      `SELECT id FROM users WHERE is_admin = TRUE AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    );
    if (!r.length) {
      return NextResponse.json({ error: "no admin user found" }, { status: 404 });
    }
    userId = r[0].id;
  }

  if (typeof body.email === "string" && body.email.includes("@")) {
    await query(
      `UPDATE users SET email = $1 WHERE id = $2`,
      [body.email.trim().toLowerCase(), userId],
    );
  }

  // Garante consent_terms_at pra pular /termos
  await query(
    `UPDATE users SET consent_terms_at = COALESCE(consent_terms_at, now()) WHERE id = $1`,
    [userId],
  );

  const rows = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, ip_address, user_agent)
     VALUES ($1, NULL, $2)
     RETURNING id`,
    [userId, "admin-issued"],
  );
  const sessionId = rows[0].id;

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
  const loginUrl = `${proto}://${host}/api/admin/login/${sessionId}`;

  return NextResponse.json({
    ok: true,
    user_id: userId,
    session_id: sessionId,
    login_url: loginUrl,
  });
}

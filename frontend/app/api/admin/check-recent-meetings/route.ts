// /api/admin/check-recent-meetings
// Lista meetings recentes de um user pra cross-check com backup local
// do mac-agent. Auth via X-Admin-Token (= WEBHOOK_TOKEN).
//
// Uso típico (mac-agent/check-backup.sh):
//   GET ?user_id=<uuid>&hours=48
//   Header: X-Admin-Token: <WEBHOOK_TOKEN>
//
// Response: { meetings: [{id, original_filename, status, created_at}], user_id, since }
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("x-admin-token") || "";
  if (!WEBHOOK_TOKEN || auth !== WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id") || "";
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "user_id (UUID) obrigatório" }, { status: 400 });
  }

  const hoursRaw = url.searchParams.get("hours");
  const hours = hoursRaw && Number.isFinite(Number(hoursRaw))
    ? Math.min(Math.max(parseInt(hoursRaw, 10), 1), 720)
    : 48;
  const sinceMs = Date.now() - hours * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();

  type Row = {
    id: string;
    original_filename: string;
    status: string;
    created_at: string;
  };

  const rows = await withTenant(userId, async (db) => {
    const r = await db.query<Row>(
      `SELECT id::text,
              original_filename,
              status,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
         FROM meetings
        WHERE created_at >= $1
        ORDER BY created_at DESC
        LIMIT 500`,
      [sinceIso],
    );
    return r.rows;
  });

  return NextResponse.json({
    meetings: rows,
    user_id: userId,
    since: sinceIso,
    count: rows.length,
  });
}

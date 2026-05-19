// ADMIN — endpoint temporário pra aplicar migrations sem psql local.
// Removido após o setup inicial. Protegido por ADMIN_TOKEN env var.
//
//   curl -X POST <host>/api/admin/sql \
//     -H "Authorization: Bearer $ADMIN_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"sql": "SELECT 1"}'
import { type NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

export async function POST(req: NextRequest) {
  if (!ADMIN_TOKEN) {
    return NextResponse.json({ error: "admin disabled (ADMIN_TOKEN unset)" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${ADMIN_TOKEN}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { sql?: string };
  try {
    body = (await req.json()) as { sql?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const sql = (body.sql || "").trim();
  if (!sql) {
    return NextResponse.json({ error: "sql obrigatório" }, { status: 400 });
  }

  try {
    const out = await withClient(async (c) => {
      const r = await c.query(sql);
      return {
        command: r.command,
        rowCount: r.rowCount ?? 0,
        rows: Array.isArray(r.rows) ? r.rows.slice(0, 100) : [],
      };
    });
    return NextResponse.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, sql_preview: sql.slice(0, 200) }, { status: 500 });
  }
}

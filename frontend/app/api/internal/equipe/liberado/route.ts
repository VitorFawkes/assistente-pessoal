import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

const TTARS_ROSTER_TOKEN = process.env.TTARS_ROSTER_TOKEN || "";
const TTARS_SSO_SECRET = process.env.TTARS_SSO_SECRET || "";

export async function POST(req: NextRequest) {
  // Autenticação: espera header x-ttars-token = TTARS_ROSTER_TOKEN ou derivado de TTARS_SSO_SECRET
  const token = req.headers.get("x-ttars-token");

  // Aceita tanto TTARS_ROSTER_TOKEN quanto TTARS_SSO_SECRET
  const validToken = token === TTARS_ROSTER_TOKEN || token === TTARS_SSO_SECRET;
  if (!validToken) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const email = (body.email || "").toString().toLowerCase().trim();

  if (!email) {
    return new NextResponse("missing email", { status: 400 });
  }

  try {
    const rows = await query<{ liberado: boolean }>(
      `SELECT liberado FROM acessos_equipe WHERE email = $1`,
      [email],
    );

    const liberado = rows.length > 0 && rows[0].liberado === true;
    return NextResponse.json({ liberado });
  } catch (err) {
    console.error("[equipe/liberado] erro", err);
    return new NextResponse("internal error", { status: 500 });
  }
}

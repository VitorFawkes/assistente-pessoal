import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export type Pessoa = {
  id: string;
  nome: string;
  aliases: string[];
  is_vitor: boolean;
  notas: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  try {
    const rows = await query<Pessoa>(
      `SELECT id, nome, aliases, is_vitor, notas,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
       FROM pessoas
       ORDER BY is_vitor DESC, nome ASC`,
    );
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

type PostBody = {
  nome?: string;
  aliases?: string[];
  notas?: string | null;
};

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  if (!nome) {
    return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  }
  if (nome.length > 80) {
    return NextResponse.json({ error: "nome muito longo (máx 80)" }, { status: 400 });
  }

  const aliases = Array.isArray(body.aliases)
    ? body.aliases.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim())
    : [];
  const notas = typeof body.notas === "string" ? body.notas.trim() || null : null;

  try {
    const rows = await query<Pessoa>(
      `INSERT INTO pessoas (nome, aliases, notas)
       VALUES ($1, $2, $3)
       ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id, nome, aliases, is_vitor, notas,
                 to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                 to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at`,
      [nome, aliases, notas],
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

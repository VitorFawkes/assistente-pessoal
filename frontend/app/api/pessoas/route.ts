import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { withTenant } from "@/lib/db";

export type Pessoa = {
  id: string;
  nome: string;
  aliases: string[];
  is_vitor: boolean;
  notas: string | null;
  sample_count: number;
  created_at: string;
  updated_at: string;
};

export const GET = withAuth(async (user) => {
  try {
    const rows = await withTenant(user.id, async (db) => {
      const r = await db.query<Pessoa>(
        `SELECT p.id, p.nome, p.aliases, p.is_vitor, p.notas,
                COALESCE((SELECT count(*)::int FROM voice_samples vs
                          WHERE vs.pessoa_id = p.id AND vs.soft_deleted_at IS NULL), 0) AS sample_count,
                to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
         FROM pessoas p
         ORDER BY p.is_vitor DESC, p.nome ASC`,
      );
      return r.rows;
    });
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

type PostBody = {
  nome?: string;
  aliases?: string[];
  notas?: string | null;
};

export const POST = withAuth(async (user, req: Request) => {
  let body: PostBody;
  try {
    body = (await (req as NextRequest).json()) as PostBody;
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
    ? body.aliases
        .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        .map((a) => a.trim())
    : [];
  const notas = typeof body.notas === "string" ? body.notas.trim() || null : null;

  try {
    const rows = await withTenant(user.id, async (db) => {
      // UNIQUE (user_id, nome) — ON CONFLICT escopado ao user
      const r = await db.query<Pessoa>(
        `INSERT INTO pessoas (user_id, nome, aliases, notas)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, nome) DO UPDATE SET nome = EXCLUDED.nome
         RETURNING id, nome, aliases, is_vitor, notas,
                   (SELECT 0)::int AS sample_count,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                   to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at`,
        [user.id, nome, aliases, notas],
      );
      return r.rows;
    });
    return NextResponse.json(rows[0], { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

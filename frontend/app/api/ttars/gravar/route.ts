import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// A página Gravar reunião do TTARS: se há gravação interrompida (a mesma conta de
// /api/gravacao/ativa) e quem vê o que a pessoa gravar (o padrão dela; sem padrão = só quem estava).
export const GET = withAuth(async (user) => {
  const rows = await query<{ id: string; chunks_count: number; last_chunk_at: string }>(
    `SELECT id, chunks_count, last_chunk_at FROM gravacao_sessoes
     WHERE user_id = $1 AND finalizada_em IS NULL
     AND last_chunk_at > now() - interval '30 minutes'
     ORDER BY last_chunk_at DESC LIMIT 1`,
    [user.id]
  );
  return NextResponse.json({
    ativa: rows[0] ?? null,
    visibilidade_padrao: user.visibilidade_padrao === "todos" ? "todos" : "so_eu",
  });
});

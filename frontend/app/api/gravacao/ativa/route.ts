import { withAuth } from "@/lib/auth";
import { query } from "@/lib/db";

export const GET = withAuth(async (user, req) => {
  try {
    const rows = await query<{ id: string; chunks_count: number; last_chunk_at: string }>(
      `SELECT id, chunks_count, last_chunk_at FROM gravacao_sessoes
       WHERE user_id = $1 AND finalizada_em IS NULL
       AND last_chunk_at > now() - interval '30 minutes'
       ORDER BY last_chunk_at DESC LIMIT 1`,
      [user.id]
    );

    if (rows.length === 0) {
      return new Response(JSON.stringify({ active: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const session = rows[0];
    return new Response(
      JSON.stringify({
        active: {
          id: session.id,
          chunks_count: session.chunks_count,
          last_chunk_at: session.last_chunk_at,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error checking active session:", error);
    return new Response(JSON.stringify({ error: "Erro ao verificar sessão" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

import { withBearerAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { tokenDoPedido } from "@/lib/ttars-auth";

// App do iPhone: sai só deste aparelho.
export const POST = withBearerAuth(async (user, req) => {
  await query(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2`, [tokenDoPedido(req), user.id]);
  return new Response(null, { status: 204 });
});

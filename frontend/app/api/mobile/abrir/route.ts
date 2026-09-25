import { withBearerAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { isTeamMode } from "@/lib/team-mode";
import { criarCodigoDeEntrada } from "@/lib/ttars-auth";

// App do iPhone: abre o site já logado, com o mesmo código de uso único (2 min) da aba do TTARS.
export const POST = withBearerAuth(async (user, req) => {
  if (!isTeamMode()) return new Response(null, { status: 404 });
  const corpo = (await req.json().catch(() => ({}))) as { para?: unknown };
  const para = typeof corpo.para === "string" && /^\/[A-Za-z0-9/_-]*$/.test(corpo.para) ? corpo.para : "/";
  const u = await query<{ email: string | null; nome: string; times: { id: string; nome: string }[] | null }>(
    `SELECT email, nome, times FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [user.id],
  );
  if (!u[0]?.email) return new Response(null, { status: 403 });
  const codigo = await criarCodigoDeEntrada({ ttarsId: "app-iphone", email: u[0].email, nome: u[0].nome, times: u[0].times || [] });
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return Response.json({ url: `${base}/api/auth/ttars?c=${codigo}&para=${encodeURIComponent(para)}` });
});

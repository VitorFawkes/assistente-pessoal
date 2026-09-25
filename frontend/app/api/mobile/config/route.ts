import { isTeamMode } from "@/lib/team-mode";

// Endereços que o app do iPhone precisa antes de entrar (a chave do TTARS é a pública, a mesma do site).
export async function GET() {
  if (!isTeamMode()) return new Response(null, { status: 404 });
  const ttars = (process.env.TTARS_ORIGENS || "").split(",")[0]?.trim() || "";
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return Response.json({
    ttars_url: (process.env.TTARS_SUPABASE_URL || "").replace(/\/$/, ""),
    ttars_chave_publica: process.env.TTARS_SUPABASE_ANON_KEY || "",
    esqueci_senha_url: ttars ? `${ttars}/forgot-password` : "",
    termos_url: `${base}/privacidade`,
  });
}

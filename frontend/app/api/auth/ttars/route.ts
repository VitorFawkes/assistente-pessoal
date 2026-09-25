import { NextRequest, NextResponse } from "next/server";
import { upsertUserFromTtars } from "@/lib/ttars-sso";
import { estaLiberado, usarCodigoDeEntrada } from "@/lib/ttars-auth";
import { setSessionCookie } from "@/lib/auth";
import { query } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

// Entrada pela aba do TTARS com o código de uso único gerado em /api/auth/ttars/entrar.
export async function GET(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
  const ir = (caminho: string) => NextResponse.redirect(`${proto}://${host}${caminho}`, 303);

  const codigo = req.nextUrl.searchParams.get("c") || "";
  const pessoa = /^[A-Za-z0-9_-]{20,64}$/.test(codigo) ? await usarCodigoDeEntrada(codigo) : null;
  if (!pessoa) return ir("/sem-acesso?motivo=link-expirado");
  if (!(await estaLiberado(pessoa.email))) return ir("/sem-acesso");

  const user = await upsertUserFromTtars({
    email: pessoa.email,
    nome: pessoa.nome,
    ttars_user_id: pessoa.ttarsId,
    times: pessoa.times,
  } as Parameters<typeof upsertUserFromTtars>[0]);

  // Quem já entrou (o Ações abre dentro do TTARS a cada clique na aba) continua na mesma
  // sessão, em vez de ganhar uma nova a cada visita.
  const atual = req.cookies.get("session")?.value || "";
  const ainda = /^[0-9a-f-]{36}$/i.test(atual)
    ? await query<{ id: string }>(
        `UPDATE sessions SET last_used_at = now()
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
            AND last_used_at > now() - interval '30 days'
          RETURNING id`,
        [atual, user.id],
      )
    : [];
  const ip = clientIp(req.headers);
  const sessao = ainda.length
    ? ainda
    : await query<{ id: string }>(
        `INSERT INTO sessions (user_id, ip_address, user_agent) VALUES ($1, $2, $3) RETURNING id`,
        [user.id, ip === "unknown" ? null : ip, (req.headers.get("user-agent") || "").slice(0, 500)],
      );
  await query(`INSERT INTO audit_log (user_id, action, metadata) VALUES ($1, 'ttars.login', $2)`, [
    user.id,
    JSON.stringify({ ttars_user_id: pessoa.ttarsId, times: pessoa.times }),
  ]);
  await setSessionCookie(sessao[0].id);
  const para = req.nextUrl.searchParams.get("para") || "/";
  return ir(/^\/[A-Za-z0-9/_-]*$/.test(para) ? para : "/");
}

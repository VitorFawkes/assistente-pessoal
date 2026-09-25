import { query } from "@/lib/db";
import { isTeamMode } from "@/lib/team-mode";
import { estaLiberado, pessoaDoTtars, tokenDoPedido } from "@/lib/ttars-auth";
import { upsertUserFromTtars } from "@/lib/ttars-sso";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// App do iPhone: a pessoa entrou no TTARS com e-mail e senha (direto no TTARS);
// aqui o login dela é conferido no próprio TTARS e vira um acesso deste aparelho.
export async function POST(req: Request) {
  if (!isTeamMode()) return new Response(null, { status: 404 });
  const ip = clientIp(req.headers);
  if (!rateLimit(`mobile-entrar:${ip}`, 20, 60_000)) {
    return Response.json({ motivo: "muitas-tentativas" }, { status: 429 });
  }
  const pessoa = await pessoaDoTtars(tokenDoPedido(req));
  if (!pessoa) return Response.json({ motivo: "ttars" }, { status: 401 });
  if (!(await estaLiberado(pessoa.email))) return Response.json({ motivo: "nao-liberado" }, { status: 403 });

  const user = await upsertUserFromTtars({
    email: pessoa.email,
    nome: pessoa.nome,
    ttars_user_id: pessoa.ttarsId,
    times: pessoa.times,
  } as Parameters<typeof upsertUserFromTtars>[0]);
  // A tela de entrar do app mostra os termos; entrar vale como aceite.
  const aceite = await query<{ consent_terms_at: string }>(
    `UPDATE users SET consent_terms_at = COALESCE(consent_terms_at, now()) WHERE id = $1 RETURNING consent_terms_at`,
    [user.id],
  );
  const sessao = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, ip_address, user_agent) VALUES ($1, $2, $3) RETURNING id`,
    [user.id, ip === "unknown" ? null : ip, `app-iphone ${(req.headers.get("user-agent") || "").slice(0, 400)}`],
  );
  await query(`INSERT INTO audit_log (user_id, action, metadata) VALUES ($1, 'ttars.login.app', $2)`, [
    user.id,
    JSON.stringify({ ttars_user_id: pessoa.ttarsId }),
  ]);
  return Response.json({
    access_token: sessao[0].id,
    user: { id: user.id, nome: user.nome, email: user.email, consent_terms_at: aceite[0]?.consent_terms_at ?? null },
  });
}

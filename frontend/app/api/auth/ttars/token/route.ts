import { query } from "@/lib/db";
import { isTeamMode } from "@/lib/team-mode";
import {
  atualizarListaDoTtars,
  cabecalhosTtars,
  ehAdmin,
  estaLiberado,
  pessoaDoTtars,
  tokenDoPedido,
} from "@/lib/ttars-auth";
import { upsertUserFromTtars } from "@/lib/ttars-sso";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Telas do Ações feitas dentro do TTARS: a tela manda o login do TTARS da pessoa e recebe
// um acesso do Ações para chamar as APIs com Authorization: Bearer. Uma sessão por pessoa
// para esse uso: se já existe uma válida, volta a mesma (não empilha uma por página aberta).
const AGENTE = "ttars-nativo";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cabecalhosTtars(req) });
}

export async function POST(req: Request) {
  const cors = cabecalhosTtars(req);
  if (!isTeamMode()) return new Response(null, { status: 404, headers: cors });
  const ip = clientIp(req.headers);
  if (!rateLimit(`ttars-token:${ip}`, 30, 60_000)) {
    return Response.json({ liberado: false, motivo: "muitas-tentativas" }, { status: 429, headers: cors });
  }
  const tokenTtars = tokenDoPedido(req);
  const pessoa = await pessoaDoTtars(tokenTtars);
  if (!pessoa) return Response.json({ liberado: false, motivo: "ttars" }, { status: 401, headers: cors });
  if (!(await estaLiberado(pessoa.email))) {
    return Response.json({ liberado: false, motivo: "nao-liberado" }, { status: 403, headers: cors });
  }

  const user = await upsertUserFromTtars({
    email: pessoa.email,
    nome: pessoa.nome,
    ttars_user_id: pessoa.ttarsId,
    times: pessoa.times,
  } as Parameters<typeof upsertUserFromTtars>[0]);
  // Entrou pelo TTARS, que já mostra os termos da empresa: vale como aceite (igual ao app).
  await query(`UPDATE users SET consent_terms_at = COALESCE(consent_terms_at, now()) WHERE id = $1`, [user.id]);
  if (await ehAdmin(pessoa.email)) {
    await atualizarListaDoTtars(tokenTtars).catch((e) => console.error("lista do TTARS:", e));
  }

  const cutoff = new Date(Date.now() - SESSION_MAX_AGE_MS).toISOString();
  const existente = await query<{ id: string }>(
    `SELECT id FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND last_used_at > $2 AND user_agent = $3
      ORDER BY last_used_at DESC LIMIT 1`,
    [user.id, cutoff, AGENTE],
  );
  let sessao = existente[0]?.id;
  if (!sessao) {
    const nova = await query<{ id: string }>(
      `INSERT INTO sessions (user_id, ip_address, user_agent) VALUES ($1, $2, $3) RETURNING id`,
      [user.id, ip === "unknown" ? null : ip, AGENTE],
    );
    sessao = nova[0].id;
    await query(`INSERT INTO audit_log (user_id, action, metadata) VALUES ($1, 'ttars.login.nativo', $2)`, [
      user.id,
      JSON.stringify({ ttars_user_id: pessoa.ttarsId }),
    ]);
  }
  const admin = await ehAdmin(pessoa.email);
  return Response.json(
    { liberado: true, token: sessao, eu: { id: user.id, nome: user.nome, email: user.email, admin } },
    { headers: cors },
  );
}

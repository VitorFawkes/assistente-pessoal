import { randomBytes } from "node:crypto";
import { query } from "./db";

// Entrada pela aba do TTARS: a aba manda o token de login do TTARS da pessoa;
// aqui ele é conferido no próprio TTARS (auth/v1/user) e nunca é guardado.
const URL_TTARS = (process.env.TTARS_SUPABASE_URL || "").replace(/\/$/, "");
const CHAVE_PUBLICA = process.env.TTARS_SUPABASE_ANON_KEY || "";

export type PessoaTtars = {
  ttarsId: string;
  email: string;
  nome: string;
  times: { id: string; nome: string }[];
};

async function lerTtars<T>(caminho: string, token: string): Promise<T | null> {
  if (!URL_TTARS || !CHAVE_PUBLICA) return null;
  const r = await fetch(`${URL_TTARS}${caminho}`, {
    headers: { apikey: CHAVE_PUBLICA, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return r.ok ? ((await r.json()) as T) : null;
}

export function tokenDoPedido(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/** Quem é a pessoa logada no TTARS (ou null se o token não vale / conta inativa). */
export async function pessoaDoTtars(token: string): Promise<PessoaTtars | null> {
  if (!token) return null;
  const u = await lerTtars<{ id: string; email?: string }>("/auth/v1/user", token);
  if (!u?.id) return null;
  const perfil = (
    await lerTtars<{ nome: string | null; email: string | null; active: boolean | null }[]>(
      `/rest/v1/profiles?select=nome,email,active&id=eq.${u.id}`,
      token,
    )
  )?.[0];
  if (perfil?.active === false) return null;
  const email = (perfil?.email || u.email || "").toLowerCase();
  if (!email) return null;
  const times =
    (await lerTtars<{ teams: { id: string; name: string } | null }[]>(
      `/rest/v1/team_members?select=teams(id,name)&user_id=eq.${u.id}`,
      token,
    )) || [];
  return {
    ttarsId: u.id,
    email,
    nome: perfil?.nome || email,
    times: times.filter((t) => t.teams).map((t) => ({ id: t.teams!.id, nome: t.teams!.name })),
  };
}

/** Liberado na tela do admin, ou já é admin deste Ações. */
export async function estaLiberado(email: string): Promise<boolean> {
  const r = await query<{ ok: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM acessos_equipe WHERE email = LOWER($1) AND liberado)
       OR EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND is_admin AND deleted_at IS NULL)
     ) AS ok`,
    [email],
  );
  return r[0]?.ok === true;
}

export async function ehAdmin(email: string): Promise<boolean> {
  const r = await query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND is_admin AND deleted_at IS NULL) AS ok`,
    [email],
  );
  return r[0]?.ok === true;
}

/**
 * Atualiza a lista de pessoas do TTARS (para a tela Liberar) com o login do
 * admin que acabou de entrar. Só pessoas ativas e com e-mail.
 */
export async function atualizarListaDoTtars(token: string): Promise<number> {
  const perfis =
    (await lerTtars<{ id: string; nome: string | null; email: string | null }[]>(
      "/rest/v1/profiles?select=id,nome,email&active=eq.true&email=not.is.null&limit=1000",
      token,
    )) || [];
  if (!perfis.length) return 0;
  const orgs =
    (await lerTtars<{ user_id: string; organizations: { name: string } | null }[]>(
      "/rest/v1/org_members?select=user_id,organizations(name)&limit=5000",
      token,
    )) || [];
  const times =
    (await lerTtars<{ user_id: string; teams: { id: string; name: string } | null }[]>(
      "/rest/v1/team_members?select=user_id,teams(id,name)&limit=5000",
      token,
    )) || [];
  const linhas = perfis.map((p) => ({
    email: String(p.email).toLowerCase(),
    nome: p.nome || String(p.email),
    organizacao: [...new Set(orgs.filter((o) => o.user_id === p.id && o.organizations).map((o) => o.organizations!.name))].join(", "),
    times: times.filter((t) => t.user_id === p.id && t.teams).map((t) => ({ id: t.teams!.id, nome: t.teams!.name })),
  }));
  await query(
    `INSERT INTO ttars_pessoas (email, nome, organizacao, times, atualizado_em)
     SELECT x.email, x.nome, x.organizacao, x.times, now()
     FROM jsonb_to_recordset($1::jsonb) AS x(email text, nome text, organizacao text, times jsonb)
     ON CONFLICT (email) DO UPDATE
       SET nome = EXCLUDED.nome, organizacao = EXCLUDED.organizacao, times = EXCLUDED.times, atualizado_em = now()`,
    [JSON.stringify(linhas)],
  );
  await query(`DELETE FROM ttars_pessoas WHERE atualizado_em < now() - interval '1 minute'`);
  return linhas.length;
}

/** Código de entrada de uso único, vale 2 minutos. */
export async function criarCodigoDeEntrada(p: PessoaTtars): Promise<string> {
  const codigo = randomBytes(24).toString("base64url");
  await query(
    `INSERT INTO codigos_entrada (codigo, email, nome, ttars_user_id, times, expira_em)
     VALUES ($1, $2, $3, $4, $5, now() + interval '2 minutes')`,
    [codigo, p.email, p.nome, p.ttarsId, JSON.stringify(p.times)],
  );
  return codigo;
}

export async function usarCodigoDeEntrada(codigo: string): Promise<PessoaTtars | null> {
  const r = await query<{ email: string; nome: string; ttars_user_id: string; times: PessoaTtars["times"] }>(
    `DELETE FROM codigos_entrada WHERE codigo = $1 RETURNING email, nome, ttars_user_id, times, expira_em > now() AS valido`,
    [codigo],
  );
  const c = r[0] as (typeof r)[number] & { valido?: boolean };
  if (!c || !c.valido) return null;
  return { email: c.email, nome: c.nome, ttarsId: c.ttars_user_id, times: c.times || [] };
}

/** CORS só para o endereço do TTARS. */
export function cabecalhosTtars(req: Request): Record<string, string> {
  const origem = req.headers.get("origin") || "";
  const permitidas = (process.env.TTARS_ORIGENS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!permitidas.includes(origem)) return {};
  return {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

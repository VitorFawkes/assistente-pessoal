import type { PoolClient } from "pg";
import { query, withTenant } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import type { AcessoConvidado } from "@/lib/quadros";

/**
 * Erro customizado pra guest: rate_limit ou invalid_token.
 * Usado pelos handlers /api/q/[token]/* pra decidir se retorna 429 ou 401.
 */
export class GuestError extends Error {
  constructor(public code: "rate_limit" | "invalid_token") {
    super(code);
  }
}

/**
 * Porta única do convidado. Resolve o token (resolver_quadro_token é
 * SECURITY DEFINER → ignora RLS), abre o tenant do DONO e roda `fn` com o
 * MESMO client `c`. REGRA: toda query do convidado DEVE usar `c` — abrir
 * outra conexão (query() ou novo withTenant) roda sem o app.current_user_id
 * dessa transação e a RLS bloquearia quadro_tarefas/quadro_convidados.
 *
 * Retorna rate_limit error se exceeded (30 req/min por token:ip).
 * Retorna invalid_token error se token não existe/revogado/quadro arquivado.
 */
export async function withGuest<T>(
  token: string,
  ip: string,
  fn: (ctx: { acesso: AcessoConvidado; c: PoolClient }) => Promise<T>,
): Promise<T> {
  // Rate limit: 30 requisições por minuto por token:ip
  if (!rateLimit(`q:${token}:${ip}`, 30, 60_000)) {
    throw new GuestError("rate_limit");
  }

  // Resolver token via SECURITY DEFINER (sem contexto tenant)
  const rows = await query<AcessoConvidado>(
    `SELECT quadro_id AS "quadroId", user_id AS "ownerId", quadro_nome AS "quadroNome",
            convidado_id AS "convidadoId", convidado_nome AS "convidadoNome"
       FROM resolver_quadro_token($1)`,
    [token],
  );

  if (rows.length === 0) {
    throw new GuestError("invalid_token");
  }

  const acesso = rows[0];

  // Abrir transação tenant do dono (RLS vai filtrar ao seu user_id)
  return withTenant(acesso.ownerId, async (c) => {
    // Best-effort update last_seen_at NO MESMO client (tenant = dono → RLS ok)
    await c.query(
      `UPDATE quadro_convidados SET last_seen_at = now() WHERE id = $1`,
      [acesso.convidadoId],
    );

    // Chamar callback com acesso + client tenantizado
    return fn({ acesso, c });
  });
}

/**
 * Verifica se uma tarefa pertence ao quadro do convidado.
 * Roda no client tenantizado `c` (RLS escopado ao dono).
 * Retorna true se a tarefa está em quadro_tarefas, false caso contrário.
 */
export async function membershipDoQuadro(
  c: PoolClient,
  quadroId: string,
  tarefaId: string,
): Promise<boolean> {
  const r = await c.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM quadro_tarefas WHERE quadro_id = $1 AND tarefa_id = $2) AS exists`,
    [quadroId, tarefaId],
  );
  return r.rows[0]?.exists ?? false;
}

import { Pool, type PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definida no ambiente");
  }
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getPool(): Pool {
  if (!global.__pgPool) {
    global.__pgPool = makePool();
  }
  return global.__pgPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(text, values);
  return res.rows as T[];
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/**
 * Roda `fn` dentro de uma transação com `app.current_user_id` setado.
 * RLS no Postgres filtra automaticamente queries por user_id (policies em
 * meetings, tarefas, pessoas, voice_samples, usage_events, tarefa_eventos).
 *
 * Usar em TODOS os pontos que retornam ou mutam dados de tabelas escopadas.
 * Endpoints "de sistema" (sessions/invites/users lookup) usam `query` direto.
 *
 * `set_config(..., true)` = SET LOCAL = escope da transação (não vaza pra
 * outras conexões do pool após COMMIT/ROLLBACK).
 */
export async function withTenant<T>(
  userId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

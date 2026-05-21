import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { query } from "./db";

const COOKIE_NAME = "session";
const SESSION_TTL_DAYS = 30;
const SESSION_MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60;

export type User = {
  id: string;
  nome: string;
  email: string | null;
  whatsapp: string | null;
  is_admin: boolean;
  consent_terms_at: string | null;
  deleted_at: string | null;
};

export class AuthError extends Error {
  constructor(public status: 401 | 403) {
    super(`auth ${status}`);
  }
}

export class InviteError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Retorna o user da sessão atual + atualiza last_used_at (sliding expiration).
 * Throws AuthError(401) se sessão inválida/expirada/revogada/user soft-deleted.
 *
 * SOMENTE chamar em Route Handlers e Server Actions (têm error handling explícito).
 * Em Server Components, chamar requireUserOrRedirect (que faz catch + redirect).
 */
export async function requireUser(): Promise<User> {
  const sessionId = (await cookies()).get(COOKIE_NAME)?.value;
  if (!sessionId) throw new AuthError(401);

  const cutoff = new Date(Date.now() - SESSION_MAX_AGE * 1000).toISOString();
  const rows = await query<{ user: User | null }>(
    `UPDATE sessions s SET last_used_at = now()
     WHERE s.id = $1 AND s.revoked_at IS NULL AND s.last_used_at > $2
     RETURNING (
       SELECT row_to_json(u)
       FROM users u
       WHERE u.id = s.user_id AND u.deleted_at IS NULL
     ) AS user`,
    [sessionId, cutoff],
  );
  const user = rows[0]?.user;
  if (!user) throw new AuthError(401);
  return user;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (!u.is_admin) throw new AuthError(403);
  return u;
}

/** Use em Server Components: catch AuthError → redirect pra /sem-acesso. */
export async function requireUserOrRedirect(): Promise<User> {
  try {
    return await requireUser();
  } catch {
    redirect("/sem-acesso");
  }
}

/**
 * Consome o convite atomicamente. Race-safe: o UPDATE com RETURNING garante
 * que apenas uma requisição concorrente ganha o claim. Se 2 chegam ao mesmo
 * tempo, a 2ª recebe RETURNING vazio (consumed_at já preenchido) e é abortada.
 */
export async function consumeInvite(
  code: string,
  nome: string,
  ip: string | null,
  userAgent: string,
): Promise<{ user: User; sessionId: string }> {
  const userRows = await query<{ id: string }>(
    `INSERT INTO users (nome) VALUES ($1) RETURNING id`,
    [nome],
  );
  const newUserId = userRows[0].id;

  const claimRows = await query<{ consumed_by: string }>(
    `UPDATE invites
       SET consumed_at = now(), consumed_by = $2
     WHERE code = $1 AND consumed_at IS NULL AND revoked_at IS NULL
     RETURNING consumed_by`,
    [code, newUserId],
  );

  if (claimRows.length === 0 || claimRows[0].consumed_by !== newUserId) {
    await query(`DELETE FROM users WHERE id = $1`, [newUserId]);
    throw new InviteError("Invite inválido ou já consumido");
  }

  const sessionRows = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, ip_address, user_agent)
     VALUES ($1, $2, $3) RETURNING id`,
    [newUserId, ip, (userAgent || "").slice(0, 500)],
  );
  const sessionId = sessionRows[0].id;

  await query(
    `INSERT INTO audit_log (user_id, action, target_id, metadata)
     VALUES ($1, 'invite.consume', $2, $3)`,
    [newUserId, code, JSON.stringify({ ip, user_agent: userAgent })],
  );

  const userFull = await query<User>(
    `SELECT id, nome, email, whatsapp, is_admin, consent_terms_at, deleted_at
       FROM users WHERE id = $1`,
    [newUserId],
  );

  return { user: userFull[0], sessionId };
}

export async function setSessionCookie(sessionId: string): Promise<void> {
  (await cookies()).set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(sessionId: string): Promise<void> {
  await query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
  (await cookies()).delete(COOKIE_NAME);
}

/** Revoga todas as sessões ativas do user — "sair de todos os dispositivos". */
export async function revokeAllSessions(userId: string): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  await query(
    `INSERT INTO audit_log (user_id, action, metadata)
     VALUES ($1, 'session.revoke_all', '{}'::jsonb)`,
    [userId],
  );
}

export async function getCurrentSessionId(): Promise<string | null> {
  return (await cookies()).get(COOKIE_NAME)?.value ?? null;
}

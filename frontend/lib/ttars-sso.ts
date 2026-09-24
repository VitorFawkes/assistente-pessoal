import { createHmac, timingSafeEqual } from "node:crypto";
import { query, withTenant } from "./db";

export type TtarsSsoClaims = {
  email: string;
  nome: string;
  ttars_user_id: string;
  orgs?: Array<{ id: string; nome: string }>;
  times?: Array<{ id: string; nome: string }>;
  exp: number;
  jti: string;
};

export class TtarsSsoError extends Error {
  constructor(
    public code:
      | "invalid_signature"
      | "expired"
      | "invalid_jti"
      | "email_not_authorized"
      | "invalid_format"
      | "invalid_claims",
    message: string,
  ) {
    super(message);
  }
}

 /**
 * Valida apenas a estrutura do JWT HS256 (sem checkar DB).
 * - Assinatura HMAC-SHA256
 * - Expiração (exp em segundos Unix)
 * - Claims obrigatórios
 *
 * NÃO valida:
 * - JTI de uso único (precisa DB)
 * - Email liberado (precisa DB)
 */
export function validateJwtSignatureAndExpiry(token: string): TtarsSsoClaims {
  const TTARS_SSO_SECRET = process.env.TTARS_SSO_SECRET || "";
  if (!TTARS_SSO_SECRET) {
    throw new TtarsSsoError("invalid_signature", "TTARS_SSO_SECRET não configurado");
  }

  // Parse JWT
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TtarsSsoError("invalid_format", "JWT inválido (não são 3 partes)");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode payload
  const payloadJson = Buffer.from(payloadB64, "base64url").toString();
  let claims: TtarsSsoClaims;
  try {
    claims = JSON.parse(payloadJson);
  } catch {
    throw new TtarsSsoError("invalid_format", "Payload não é JSON válido");
  }

  // Validar claims obrigatórios
  if (!claims.email || !claims.nome || !claims.ttars_user_id || !claims.jti) {
    throw new TtarsSsoError(
      "invalid_claims",
      "Claims obrigatórios faltam (email, nome, ttars_user_id, jti)",
    );
  }

  if (typeof claims.exp !== "number") {
    throw new TtarsSsoError("invalid_claims", "exp deve ser number");
  }

  // Validar assinatura
  const expectedSignature = createHmac("sha256", TTARS_SSO_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  const a = Buffer.from(signatureB64);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new TtarsSsoError("invalid_signature", "Assinatura inválida");
  }

  // Validar expiração (exp em segundos Unix)
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > claims.exp) {
    throw new TtarsSsoError("expired", `Token expirado (exp=${claims.exp}, now=${nowSec})`);
  }

  return claims;
}

/**
 * Valida JWT HS256 assinado pelo TTARS COM checagem de DB.
 * Checks:
 * - Assinatura HMAC-SHA256
 * - Expiração (exp em segundos Unix)
 * - JTI de uso único (prevenção de replay)
 * - Email liberado (ou user é admin)
 */
export async function validateTtarsSsoToken(token: string): Promise<TtarsSsoClaims> {
  // Validar assinatura e expiração
  const claims = validateJwtSignatureAndExpiry(token);

  // Liberado na tabela, ou admin já cadastrado neste banco (nunca pelo token)
  const access = await query<{ ok: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM acessos_equipe WHERE email = LOWER($1) AND liberado)
       OR EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND is_admin AND deleted_at IS NULL)
     ) AS ok`,
    [claims.email],
  );
  if (!access[0]?.ok) {
    throw new TtarsSsoError("email_not_authorized", "Email não está liberado");
  }

  // Uso único: grava o jti; se já existia, é reuso
  const novo = await query<{ jti: string }>(
    `INSERT INTO jti_usados (jti) VALUES ($1) ON CONFLICT DO NOTHING RETURNING jti`,
    [claims.jti],
  );
  if (!novo.length) {
    throw new TtarsSsoError("invalid_jti", "JTI já foi usado (replay attempt)");
  }

  return claims;
}

/**
 * Cria ou atualiza um user a partir de claims do TTARS. Também cria a pessoa
 * "sou eu" (is_vitor=true) na primeira vez.
 */
export async function upsertUserFromTtars(
  claims: TtarsSsoClaims,
  userId?: string,
): Promise<{ id: string; nome: string; email: string; times: Array<{ id: string; nome: string }> }> {
  // Normalizar email pra comparação
  const normalizedEmail = claims.email.toLowerCase();
  const times = claims.times || [];

  let user;

  if (userId) {
    // Atualizar user existente
    const rows = await query<{
      id: string;
      nome: string;
      email: string;
      times: Array<{ id: string; nome: string }>;
    }>(
      `UPDATE users
       SET nome = $2, email = $3, times = $4
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, nome, email, times`,
      [userId, claims.nome, normalizedEmail, JSON.stringify(times)],
    );
    if (!rows.length) {
      throw new Error("User não encontrado ou foi deletado");
    }
    user = rows[0];
  } else {
    // Inserir novo user

    const rows = await query<{
      id: string;
      nome: string;
      email: string;
      times: Array<{ id: string; nome: string }>;
    }>(
      `INSERT INTO users (nome, email, times, is_admin, consent_terms_at)
       VALUES ($1, $2, $3, false, NULL)
       ON CONFLICT (email) WHERE email IS NOT NULL AND deleted_at IS NULL DO UPDATE
       SET nome = EXCLUDED.nome, times = EXCLUDED.times
       RETURNING id, nome, email, times`,
      [claims.nome, normalizedEmail, JSON.stringify(times)],
    );
    if (!rows.length) {
      throw new Error("Erro ao inserir/atualizar user");
    }
    user = rows[0];

    // Criar pessoa "sou eu" na primeira vez
    const donoId = user.id;
    await withTenant(donoId, (db) =>
      db.query(
        `INSERT INTO pessoas (user_id, nome, is_vitor)
         SELECT $1, $2, TRUE
         WHERE NOT EXISTS (SELECT 1 FROM pessoas WHERE user_id = $1 AND is_vitor)
         ON CONFLICT (user_id, nome) DO UPDATE SET is_vitor = TRUE`,
        [donoId, claims.nome],
      ),
    );
  }

  return user;
}

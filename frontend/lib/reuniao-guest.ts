// Porta de quem recebe o link de leitura de uma reunião (/r/[token]).
//
// Diferente do quadro: aqui não existe escrita, então não precisa de um client
// preso à transação. Resolvemos o token (SECURITY DEFINER, sem contexto de
// tenant) e devolvemos QUAL reunião e DE QUEM — a leitura em si passa pelos
// helpers normais de lib/queries.ts, escopados ao tenant do dono. O id da
// reunião vem SEMPRE do token, nunca da URL, então não há como pedir outra.
import { query } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export type AcessoReuniao = { meetingId: string; ownerId: string };

export class ReuniaoGuestError extends Error {
  constructor(public code: "rate_limit" | "invalid_token") {
    super(code);
  }
}

/** 60 leituras por minuto por token:ip — a página faz várias (folha, download). */
export async function acessoPorToken(token: string, ip: string): Promise<AcessoReuniao> {
  if (!rateLimit(`r:${token}:${ip}`, 60, 60_000)) {
    throw new ReuniaoGuestError("rate_limit");
  }
  const rows = await query<AcessoReuniao>(
    `SELECT meeting_id AS "meetingId", owner_id AS "ownerId"
       FROM resolver_reuniao_token($1)`,
    [token],
  );
  if (rows.length === 0) throw new ReuniaoGuestError("invalid_token");
  return rows[0];
}

/** Versão que devolve null em vez de estourar — pras páginas. */
export async function acessoPorTokenOuNull(
  token: string,
  ip: string,
): Promise<AcessoReuniao | null> {
  try {
    return await acessoPorToken(token, ip);
  } catch (e) {
    if (e instanceof ReuniaoGuestError) return null;
    throw e;
  }
}

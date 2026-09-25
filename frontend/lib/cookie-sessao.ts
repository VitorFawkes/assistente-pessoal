import { isTeamMode } from "./team-mode";

export const COOKIE_SESSAO = "session";
export const MAX_AGE_SESSAO = 30 * 24 * 60 * 60;

/**
 * Atributos do cookie de sessão.
 * Equipe: o Ações abre DENTRO do TTARS (outro site, num quadro da página). Com SameSite=Lax
 * o navegador não manda o cookie pra dentro do quadro e a pessoa cai em "sem acesso".
 * SameSite=None + Partitioned guarda o cookie só para o par TTARS → Ações (é o que Chrome,
 * Edge, Firefox e Safari 18.4+ aceitam mesmo bloqueando cookie de terceiros). A proteção
 * contra pedido forjado de outro site fica no proxy (Sec-Fetch-Site).
 */
export function opcoesCookieSessao(maxAge = MAX_AGE_SESSAO) {
  const equipe = isTeamMode();
  return {
    httpOnly: true,
    secure: equipe || process.env.NODE_ENV === "production",
    sameSite: (equipe ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge,
    ...(equipe ? { partitioned: true } : {}),
  };
}

/** Sites que podem mostrar o Ações dentro da página deles (a aba do TTARS). */
export function origensQuePodemEmbutir(): string[] {
  return (process.env.TTARS_ORIGENS || "")
    .split(",")
    .map((s) => s.trim())
    // https sempre; http só o localhost de quem desenvolve (teste da aba numa página local).
    .filter((s) => /^(https:\/\/[a-z0-9.-]+|http:\/\/localhost(:\d+)?)$/i.test(s));
}

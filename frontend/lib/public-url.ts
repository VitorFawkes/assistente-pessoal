/** Absolute link to a page of Ações, for messages that leave the site (WhatsApp). Same domain the old WhatsApp notices used. */
export const acoesUrl = (path = "/") => (process.env.NEXT_PUBLIC_BASE_URL || "https://acoes.vitorgambetti.com.br").replace(/\/+$/, "") + path;

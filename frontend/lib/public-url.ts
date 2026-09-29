/** Absolute link to a page of Ações, for messages that leave the site (WhatsApp). Same domain the old WhatsApp notices used.
 *  Ações da equipe: quem lê usa o Ações dentro do TTARS, então o link abre lá (TTARS_ACOES_URL, ex. https://ttars.vercel.app/acoes). */
export const acoesUrl = (path = "/") => {
 const ttars = process.env.TTARS_ACOES_URL?.trim();
 if (ttars) return ttars.replace(/\/+$/, "") + (path === "/" ? "" : path);
 return (process.env.NEXT_PUBLIC_BASE_URL || "https://acoes.vitorgambetti.com.br").replace(/\/+$/, "") + path;
};

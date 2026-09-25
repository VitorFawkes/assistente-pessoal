import { cookies } from "next/headers";
import { isTeamMode } from "./team-mode";

/**
 * "Pele" = o Ações vestido de TTARS. Quando a pessoa abre o Ações pela aba do TTARS, o
 * Ações perde o cabeçalho e o rodapé dele e usa as cores e a letra do TTARS (Trips ou
 * Weddings), pra parecer uma tela do TTARS. Guardada num cookie Partitioned: só vale
 * dentro do TTARS; aberto direto, o Ações continua com a cara dele.
 */
export type Pele = "ttars-trips" | "ttars-ww";
export const COOKIE_PELE = "pele";

export function peleDoPedido(v: string | null | undefined): Pele | null {
  if (v === "trips") return "ttars-trips";
  if (v === "ww") return "ttars-ww";
  return null;
}

export async function peleAtual(): Promise<Pele | null> {
  if (!isTeamMode()) return null;
  const v = (await cookies()).get(COOKIE_PELE)?.value;
  return v === "ttars-trips" || v === "ttars-ww" ? v : null;
}

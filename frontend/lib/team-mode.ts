/**
 * Configuração de modo equipe.
 * Quando TEAM_MODE=1, a instância está em modo equipe com:
 * - Menu reduzido (Pendências, Reuniões, Pessoas)
 * - Bloqueio de rotas para não-admin (Plano, Quadros, Coach, Assistente)
 * - Termos da Welcome
 */

export function isTeamMode(): boolean {
  const v = process.env.NEXT_PUBLIC_TEAM_MODE || process.env.TEAM_MODE;
  return v === "1" || v === "true";
}

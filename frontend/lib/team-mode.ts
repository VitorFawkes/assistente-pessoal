/**
 * Configuração de modo equipe.
 * Quando TEAM_MODE=1, a instância está em modo equipe com:
 * - Menu reduzido (Pendências, Reuniões, Pessoas)
 * - Bloqueio de rotas para não-admin (Plano, Quadros, Coach, Assistente)
 * - Termos da Welcome
 */

export function isTeamMode(): boolean {
  return process.env.TEAM_MODE === "1";
}

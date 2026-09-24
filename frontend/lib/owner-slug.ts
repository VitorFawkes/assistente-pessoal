/**
 * Configuração do slug do dono da conta.
 * Em modo equipe (TEAM_MODE), pode ser alterado via variável de ambiente.
 * Padrão: "vitor" (manter compatibilidade com a instância principal).
 */

export function getOwnerSlug(): string {
  return process.env.NEXT_PUBLIC_OWNER_SLUG || process.env.OWNER_SLUG || "vitor";
}

/**
 * Verifica se um nome/owner é o dono da conta.
 * Comparação case-insensitive.
 */
export function isOwner(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase() === getOwnerSlug().toLowerCase();
}

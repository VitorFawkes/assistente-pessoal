/**
 * Rate limiter in-memory por chave (tipicamente IP).
 * Suficiente pra instância única do easypanel. Se virar multi-replica,
 * migrar pra Postgres-backed (tabela rate_limit_buckets) ou Redis.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  maxRequests = 5,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (arr.length >= maxRequests) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

/** Pega o IP do cliente respeitando proxies (easypanel proxy seta x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

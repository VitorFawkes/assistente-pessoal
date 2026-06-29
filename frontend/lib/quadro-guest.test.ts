import { describe, it, expect } from "bun:test";
import { GuestError } from "./quadro-guest";
import { rateLimit } from "./rate-limit";

describe("GuestError", () => {
  it("should create error with rate_limit code", () => {
    const err = new GuestError("rate_limit");
    expect(err.code).toBe("rate_limit");
    expect(err.message).toBe("rate_limit");
  });

  it("should create error with invalid_token code", () => {
    const err = new GuestError("invalid_token");
    expect(err.code).toBe("invalid_token");
    expect(err.message).toBe("invalid_token");
  });

  it("should be instanceof Error", () => {
    const err = new GuestError("invalid_token");
    expect(err instanceof Error).toBe(true);
  });

  it("should have correct code property", () => {
    const rateLimitErr = new GuestError("rate_limit");
    const invalidTokenErr = new GuestError("invalid_token");

    expect(rateLimitErr.code === "rate_limit").toBe(true);
    expect(invalidTokenErr.code === "invalid_token").toBe(true);
  });
});

describe("Guest Rate Limiting", () => {
  it("should allow 30 requests per minute for a single token:ip", () => {
    const key = `guest_${Date.now()}_ratetest`;
    const maxRequests = 30;
    const windowMs = 60_000;

    // Fazer 30 requisições
    for (let i = 0; i < maxRequests; i++) {
      const allowed = rateLimit(key, maxRequests, windowMs);
      expect(allowed).toBe(true);
    }

    // 31ª deve ser rejeitada
    const rejected = rateLimit(key, maxRequests, windowMs);
    expect(rejected).toBe(false);
  });

  it("should handle different token:ip combinations independently", () => {
    const key1 = `guest_${Date.now()}_token1_ip1`;
    const key2 = `guest_${Date.now()}_token1_ip2`;
    const maxRequests = 3;
    const windowMs = 60_000;

    // token1:ip1 — 3 requisições OK
    expect(rateLimit(key1, maxRequests, windowMs)).toBe(true);
    expect(rateLimit(key1, maxRequests, windowMs)).toBe(true);
    expect(rateLimit(key1, maxRequests, windowMs)).toBe(true);

    // token1:ip2 (diferente IP, mesmo token) — 3 requisições OK também
    expect(rateLimit(key2, maxRequests, windowMs)).toBe(true);
    expect(rateLimit(key2, maxRequests, windowMs)).toBe(true);
    expect(rateLimit(key2, maxRequests, windowMs)).toBe(true);

    // key1 5ª requisição — bloqueado
    expect(rateLimit(key1, maxRequests, windowMs)).toBe(false);

    // key2 4ª requisição — bloqueado também
    expect(rateLimit(key2, maxRequests, windowMs)).toBe(false);
  });
});

/**
 * Security & Integration Tests (requires DB connection + live quadro/convidado):
 *
 * ✗ Task 28.1: convidado com token1 tenta acessar tarefa fora do quadro1 → validação membership falha → 404
 *   Requer: DB com quadro1, tarefa T1 (in quadro1), tarefa T2 (out quadro1), token1 válido
 *   Teste: withGuest → membershipDoQuadro(c, quadro1.id, T2.id) → false → handler retorna 404
 *   Status: PENDENTE teste com DB
 *
 * ✗ Task 28.2: token revogado → resolver_quadro_token retorna 0 rows → 401
 *   Requer: DB com token revogado (revoked_at IS NOT NULL)
 *   Teste: query("/api/q/[revoked_token]/tarefas") → 401
 *   Status: PENDENTE teste com DB
 *
 * ✗ Task 28.3: evento criado por convidado → quadro_convidado_id é setado (não NULL)
 *   Requer: DB com tarefa criada via POST /api/q/[token]/tarefas
 *   Teste: verificar em tarefa_eventos que quadro_convidado_id = acesso.convidadoId
 *   Status: PENDENTE teste com DB
 *
 * ✗ Task 28.4: rate-limit 31 requisições em 60s → 31ª recebe 429
 *   Requer: rateLimit() com state em-memória
 *   Teste: chamar rateLimit(key, 30, 60_000) 31 vezes → 31ª retorna false
 *   Status: PENDENTE teste com rate-limit helper
 *
 * ✗ Task 28.5: convidado1 não consegue listar tarefas de quadro2 (mesmo com brute-force token) → 401
 *   Requer: DB com token1 (para quadro1), tentativa de acesso via GET /api/q/[fake_token]/tarefas
 *   Teste: resolver_quadro_token([fake_token]) retorna 0 rows → 401
 *   Status: PENDENTE teste com DB
 */

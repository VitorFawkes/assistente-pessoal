import { describe, it, expect, beforeEach } from "bun:test";
import { rateLimit, clientIp } from "./rate-limit";

// Hack: limpar buckets entre testes (rate-limit usa Map global)
// Para isso, recreamos o módulo ou resetamos o estado, mas bun:test não suporta isso nativamente
// Como alternativa, usamos chaves únicas por teste

describe("rateLimit", () => {
  it("should allow requests up to maxRequests", () => {
    const key = `test_${Date.now()}_1`;
    const max = 3;
    const window = 10_000;

    const r1 = rateLimit(key, max, window);
    const r2 = rateLimit(key, max, window);
    const r3 = rateLimit(key, max, window);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(true);
  });

  it("should reject N+1th request", () => {
    const key = `test_${Date.now()}_2`;
    const max = 2;
    const window = 10_000;

    const r1 = rateLimit(key, max, window);
    const r2 = rateLimit(key, max, window);
    const r3 = rateLimit(key, max, window);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(false);
  });

  it("should handle different keys independently", () => {
    const key1 = `test_${Date.now()}_key1`;
    const key2 = `test_${Date.now()}_key2`;
    const max = 2;
    const window = 10_000;

    const r1_1 = rateLimit(key1, max, window);
    const r1_2 = rateLimit(key1, max, window);
    const r1_3 = rateLimit(key1, max, window);

    const r2_1 = rateLimit(key2, max, window);
    const r2_2 = rateLimit(key2, max, window);
    const r2_3 = rateLimit(key2, max, window);

    expect(r1_1).toBe(true);
    expect(r1_2).toBe(true);
    expect(r1_3).toBe(false); // key1 exhausted

    expect(r2_1).toBe(true);
    expect(r2_2).toBe(true);
    expect(r2_3).toBe(false); // key2 exhausted
  });
});

describe("clientIp", () => {
  it("should extract IP from x-forwarded-for header", () => {
    const headers = new Headers();
    headers.set("x-forwarded-for", "192.168.1.1, 10.0.0.1");

    const ip = clientIp(headers);
    expect(ip).toBe("192.168.1.1");
  });

  it("should handle x-forwarded-for with whitespace", () => {
    const headers = new Headers();
    headers.set("x-forwarded-for", "  192.168.1.1  , 10.0.0.1");

    const ip = clientIp(headers);
    expect(ip).toBe("192.168.1.1");
  });

  it("should use x-real-ip if x-forwarded-for not present", () => {
    const headers = new Headers();
    headers.set("x-real-ip", "192.168.1.5");

    const ip = clientIp(headers);
    expect(ip).toBe("192.168.1.5");
  });

  it("should return 'unknown' if no headers present", () => {
    const headers = new Headers();

    const ip = clientIp(headers);
    expect(ip).toBe("unknown");
  });

  it("should prefer x-forwarded-for over x-real-ip", () => {
    const headers = new Headers();
    headers.set("x-forwarded-for", "192.168.1.1");
    headers.set("x-real-ip", "192.168.1.5");

    const ip = clientIp(headers);
    expect(ip).toBe("192.168.1.1");
  });
});

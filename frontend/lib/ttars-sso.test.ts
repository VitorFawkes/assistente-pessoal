import { describe, it, expect, beforeEach } from "bun:test";
import { createHmac } from "node:crypto";
import { validateJwtSignatureAndExpiry, TtarsSsoError } from "./ttars-sso";

const SECRET = "test-secret-key-12345";

function createToken(claims: Record<string, unknown>, overrideSecret?: string): string {
  const secret = overrideSecret || SECRET;

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString("base64url");

  const signature = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  return `${headerB64}.${payloadB64}.${signature}`;
}

describe("validateJwtSignatureAndExpiry", () => {
  beforeEach(() => {
    process.env.TTARS_SSO_SECRET = SECRET;
  });

  it("valida token correto", () => {
    const jti = `test-jti-${Date.now()}-${Math.random()}`;
    const claims = {
      email: "user@welcome.com",
      nome: "Test User",
      ttars_user_id: "ttars-123",
      exp: Math.floor(Date.now() / 1000) + 120,
      jti,
    };

    const token = createToken(claims);
    const result = validateJwtSignatureAndExpiry(token);

    expect(result.email).toBe("user@welcome.com");
    expect(result.nome).toBe("Test User");
    expect(result.ttars_user_id).toBe("ttars-123");
  });

  it("rejeita token com assinatura errada", () => {
    const jti = `test-jti-${Date.now()}-${Math.random()}`;
    const claims = {
      email: "user@welcome.com",
      nome: "Test User",
      ttars_user_id: "ttars-123",
      exp: Math.floor(Date.now() / 1000) + 120,
      jti,
    };

    const token = createToken(claims, "wrong-secret");

    try {
      validateJwtSignatureAndExpiry(token);
      expect.unreachable("deveria ter lançado erro de assinatura");
    } catch (e) {
      expect(e).toBeInstanceOf(TtarsSsoError);
      expect((e as TtarsSsoError).code).toBe("invalid_signature");
    }
  });

  it("rejeita token expirado", () => {
    const jti = `test-jti-${Date.now()}-${Math.random()}`;
    const claims = {
      email: "user@welcome.com",
      nome: "Test User",
      ttars_user_id: "ttars-123",
      exp: Math.floor(Date.now() / 1000) - 10, // 10s atrás
      jti,
    };

    const token = createToken(claims);

    try {
      validateJwtSignatureAndExpiry(token);
      expect.unreachable("deveria ter lançado erro de expiração");
    } catch (e) {
      expect(e).toBeInstanceOf(TtarsSsoError);
      expect((e as TtarsSsoError).code).toBe("expired");
    }
  });

  it("rejeita token sem claims obrigatórios", () => {
    const exp = Math.floor(Date.now() / 1000) + 120;
    const jti = `test-jti-${Date.now()}-${Math.random()}`;

    // Falta email
    const claims1 = {
      nome: "Test User",
      ttars_user_id: "ttars-123",
      exp,
      jti,
    };

    try {
      const token = createToken(claims1);
      validateJwtSignatureAndExpiry(token);
      expect.unreachable("deveria ter rejeitado falta de email");
    } catch (e) {
      expect(e).toBeInstanceOf(TtarsSsoError);
      expect((e as TtarsSsoError).code).toBe("invalid_claims");
    }
  });

  it("rejeita token com JTI faltando", () => {
    const exp = Math.floor(Date.now() / 1000) + 120;

    // Falta jti
    const claims = {
      email: "user@welcome.com",
      nome: "Test User",
      ttars_user_id: "ttars-123",
      exp,
    };

    try {
      const token = createToken(claims);
      validateJwtSignatureAndExpiry(token);
      expect.unreachable("deveria ter rejeitado falta de jti");
    } catch (e) {
      expect(e).toBeInstanceOf(TtarsSsoError);
      expect((e as TtarsSsoError).code).toBe("invalid_claims");
    }
  });

  it("rejeita token com formato inválido", () => {
    const token = "not-a-jwt";

    try {
      validateJwtSignatureAndExpiry(token);
      expect.unreachable("deveria ter rejeitado formato inválido");
    } catch (e) {
      expect(e).toBeInstanceOf(TtarsSsoError);
      expect((e as TtarsSsoError).code).toBe("invalid_format");
    }
  });

  it("rejeita token com payload não-JSON", () => {
    const header = {
      alg: "HS256",
      typ: "JWT",
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from("not-json").toString("base64url");
    const signature = createHmac("sha256", SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    const token = `${headerB64}.${payloadB64}.${signature}`;

    try {
      validateJwtSignatureAndExpiry(token);
      expect.unreachable("deveria ter rejeitado payload não-JSON");
    } catch (e) {
      expect(e).toBeInstanceOf(TtarsSsoError);
      expect((e as TtarsSsoError).code).toBe("invalid_format");
    }
  });

  it("suporta claims opcionais (orgs, times)", () => {
    const jti = `test-jti-opt-${Date.now()}-${Math.random()}`;
    const claims = {
      email: "user@welcome.com",
      nome: "Test User",
      ttars_user_id: "ttars-123",
      orgs: [{ id: "org-1", nome: "Welcome Trips" }],
      times: [{ id: "time-1", nome: "Vendas" }],
      exp: Math.floor(Date.now() / 1000) + 120,
      jti,
    };

    const token = createToken(claims);
    const result = validateJwtSignatureAndExpiry(token);

    expect(result.orgs).toEqual([{ id: "org-1", nome: "Welcome Trips" }]);
    expect(result.times).toEqual([{ id: "time-1", nome: "Vendas" }]);
  });
});

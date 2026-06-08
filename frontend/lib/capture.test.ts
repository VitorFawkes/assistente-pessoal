import { test, expect, describe } from "bun:test";
import { normalizeDraft, precisaRevisao, type RawDraft } from "./capture";

describe("normalizeDraft", () => {
  test("aplica defaults quando o GPT omite campos", () => {
    const d = normalizeDraft({ titulo: "ligar pro contador" } as RawDraft);
    expect(d.titulo).toBe("ligar pro contador");
    expect(d.owner).toBe("vitor");
    expect(d.acao).toBe("executar");
    expect(d.prioridade).toBe("media");
    expect(d.prazo).toBeNull();
    expect(d.pessoas).toEqual([]);
    expect(d.confidence).toBe("low"); // sem confidence explícito → low
  });

  test("coage valores inválidos pros defaults", () => {
    const d = normalizeDraft({ titulo: "x", acao: "delegar", prioridade: "altíssima" } as unknown as RawDraft);
    expect(d.acao).toBe("executar");
    expect(d.prioridade).toBe("media");
  });

  test("preserva campos válidos", () => {
    const d = normalizeDraft({
      titulo: "cobrar relatório", owner: "Estela", acao: "cobrar",
      prazo: "2026-06-12T23:59:00Z", prazo_text: "até quinta",
      prioridade: "alta", area_raw: "Vendas/SDR", pessoas: ["Estela"],
      confidence: "high", confidence_rationale: "delegação clara",
    });
    expect(d.owner).toBe("Estela");
    expect(d.acao).toBe("cobrar");
    expect(d.pessoas).toEqual(["Estela"]);
    expect(d.confidence).toBe("high");
  });

  test("titulo vazio vira string vazia (rota decide o que fazer)", () => {
    const d = normalizeDraft({} as RawDraft);
    expect(d.titulo).toBe("");
  });
});

describe("precisaRevisao", () => {
  test("confidence != high → true", () => {
    expect(precisaRevisao({ confidence: "low", prazo: null, prazo_text: null } as any)).toBe(true);
    expect(precisaRevisao({ confidence: "medium", prazo: "2026-06-12", prazo_text: "quinta" } as any)).toBe(true);
  });
  test("confidence high sem pendência → false", () => {
    expect(precisaRevisao({ confidence: "high", prazo: "2026-06-12", prazo_text: "quinta" } as any)).toBe(false);
    expect(precisaRevisao({ confidence: "high", prazo: null, prazo_text: null } as any)).toBe(false);
  });
  test("high mas tinha texto temporal e prazo não resolveu → true", () => {
    expect(precisaRevisao({ confidence: "high", prazo: null, prazo_text: "semana que vem" } as any)).toBe(true);
  });
});

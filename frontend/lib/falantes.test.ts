import { describe, expect, it } from "bun:test";
import { trocarFalantes } from "./falantes";

const LABELS = { A: "Vitor Gambetti", B: "Aniquinha" };

describe("trocarFalantes", () => {
  it("troca a letra pelo nome escolhido", () => {
    expect(trocarFalantes("Garantir o pagamento da comissão a Speaker A", LABELS)).toBe(
      "Garantir o pagamento da comissão a Vitor Gambetti",
    );
    expect(trocarFalantes("dinheiro para a pessoa (provavelmente Speaker B) e combinar", LABELS)).toBe(
      "dinheiro para a pessoa (provavelmente Aniquinha) e combinar",
    );
  });

  it("aceita falante/locutor e letra minúscula", () => {
    expect(trocarFalantes("Falante b pediu", LABELS)).toBe("Aniquinha pediu");
    expect(trocarFalantes("speaker a e Speaker B", LABELS)).toBe("Vitor Gambetti e Aniquinha");
  });

  it("mantém a letra sem nome e não mexe no resto", () => {
    expect(trocarFalantes("Speaker C falou com Speaker A", LABELS)).toBe("Speaker C falou com Vitor Gambetti");
    expect(trocarFalantes("Speakers do evento", LABELS)).toBe("Speakers do evento");
    expect(trocarFalantes("Loudspeaker A quebrado", LABELS)).toBe("Loudspeaker A quebrado");
  });

  it("sem rótulos ou sem texto, devolve como veio", () => {
    expect(trocarFalantes("Speaker A", null)).toBe("Speaker A");
    expect(trocarFalantes(null, LABELS)).toBeNull();
    expect(trocarFalantes("Speaker A", { A: "Speaker A" })).toBe("Speaker A");
  });
});

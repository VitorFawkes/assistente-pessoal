import { describe, expect, it } from "bun:test";
import { acharPessoaPorNome, ehEu } from "./pessoa-por-nome";

const P = [
  { email: "paula@w.com", nome: "Paula Klotz" },
  { email: "ana.t@w.com", nome: "Ana Tereza" },
  { email: "ana.c@w.com", nome: "Ana Carolina Kuss" },
  { email: "mariana.b@w.com", nome: "Mariana de Barros Domingues" },
  { email: "mariana.r@w.com", nome: "Mariana Rosales Mocochinski" },
  { email: "giulia@w.com", nome: "Giúlia" },
];

describe("acharPessoaPorNome", () => {
  it("primeiro nome único acha a pessoa, com ou sem acento e artigo", () => {
    expect(acharPessoaPorNome("Paula", P)).toEqual({ pessoa: P[0] });
    expect(acharPessoaPorNome("pra Paula", P)).toEqual({ pessoa: P[0] });
    expect(acharPessoaPorNome("giulia", P)).toEqual({ pessoa: P[5] });
  });

  it("nome inteiro ou começo do nome desempata", () => {
    expect(acharPessoaPorNome("Ana Tereza", P)).toEqual({ pessoa: P[1] });
    expect(acharPessoaPorNome("Ana Carolina", P)).toEqual({ pessoa: P[2] });
    expect(acharPessoaPorNome("Mariana Rosales", P)).toEqual({ pessoa: P[4] });
    expect(acharPessoaPorNome("Mariana Domingues", P)).toEqual({ pessoa: P[3] });
  });

  it("nome repetido não chuta: devolve as candidatas", () => {
    expect(acharPessoaPorNome("Ana", P)).toEqual({ ambiguas: [P[1], P[2]] });
    expect(acharPessoaPorNome("Mariana", P)).toEqual({ ambiguas: [P[3], P[4]] });
  });

  it("nome de fora da Welcome não acha ninguém", () => {
    expect(acharPessoaPorNome("contador", P)).toBeNull();
    expect(acharPessoaPorNome("?", P)).toBeNull();
    expect(acharPessoaPorNome("", P)).toBeNull();
  });

  it("reconhece quando é a própria pessoa", () => {
    expect(ehEu("eu")).toBe(true);
    expect(ehEu("Mim")).toBe(true);
    expect(ehEu("Paula")).toBe(false);
  });
});

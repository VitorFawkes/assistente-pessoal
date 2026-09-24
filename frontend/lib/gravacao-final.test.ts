import { describe, expect, test } from "bun:test";
import { idDeGravacaoValido, nomeDoPedaco, ordenarPedacos } from "./gravacao-final";

describe("ordenarPedacos", () => {
  test("ordena pela parte e pelo número, ignora o que não é pedaço", () => {
    const r = ordenarPedacos(["200-1.bin", "100-10.bin", "100-2.bin", "lixo.txt", "../x.bin", "200-0.bin", "100-0.bin"]);
    expect(r).toEqual([
      { parte: 100, pedacos: ["100-0.bin", "100-2.bin", "100-10.bin"] },
      { parte: 200, pedacos: ["200-0.bin", "200-1.bin"] },
    ]);
  });
  test("nome do pedaço segue o formato lido", () => {
    expect(ordenarPedacos([nomeDoPedaco(5, 3)])).toEqual([{ parte: 5, pedacos: ["5-3.bin"] }]);
  });
});

describe("idDeGravacaoValido", () => {
  test("só aceita uuid", () => {
    expect(idDeGravacaoValido("9cd870b7-7540-4666-a6fe-e4cb08b9e5d8")).toBe(true);
    expect(idDeGravacaoValido("../94afdc5f")).toBe(false);
    expect(idDeGravacaoValido("")).toBe(false);
  });
});

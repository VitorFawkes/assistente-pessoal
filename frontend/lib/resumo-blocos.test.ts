import { describe, expect, test } from "bun:test";
import {
  aninharPorBloco,
  pareceRotulo,
  type Item,
} from "@/app/reunioes/[id]/executive-summary";

const it = (text: string, children: Item[] = []): Item => ({ text, children });

describe("pareceRotulo", () => {
  test("rótulo de subgrupo com irmãos abaixo é rótulo", () => {
    expect(pareceRotulo(it("Site / Landing pages / UX"), 3)).toBe(true);
    expect(pareceRotulo(it("CRM / Funil / Objetos"), 4)).toBe(true);
    expect(pareceRotulo(it("Parametrização/Tracking"), 5)).toBe(true);
  });

  test("sozinho no bloco não é rótulo — não sobra nada embaixo", () => {
    expect(pareceRotulo(it("Site / Landing pages / UX"), 0)).toBe(false);
  });

  test("frase com ponto final é conteúdo, não rótulo", () => {
    expect(pareceRotulo(it("Definir a meta do Q4."), 3)).toBe(false);
    expect(pareceRotulo(it("Falta clareza de quem qualifica;"), 2)).toBe(false);
  });

  test("frase longa é conteúdo, mesmo sem pontuação", () => {
    const longa =
      "Risco de termos bons terem sido negativados no passado sem visibilidade clara do histórico";
    expect(pareceRotulo(it(longa), 3)).toBe(false);
  });

  test("item que já tem filhos próprios não vira rótulo de novo", () => {
    expect(pareceRotulo(it("Dono: Vitor", [it("Entregável: x")]), 3)).toBe(false);
  });

  test("texto vazio não é rótulo", () => {
    expect(pareceRotulo(it(""), 3)).toBe(false);
  });
});

describe("aninharPorBloco", () => {
  test("o primeiro item vira título e os irmãos descem pra baixo dele", () => {
    const out = aninharPorBloco([
      [it("Site / Landing pages / UX"), it("Landing pages ruins."), it("WordPress lento.")],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Site / Landing pages / UX");
    expect(out[0].children).toHaveLength(2);
  });

  test("bloco sem rótulo fica chapado — nenhum item é promovido", () => {
    const out = aninharPorBloco([
      [it("Reunião remota entre Vitor e o especialista de growth."), it("Assunto central: diagnóstico.")],
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].children).toHaveLength(0);
  });

  test("nenhum item de conteúdo é perdido no caminho", () => {
    const blocos = [
      [it("Grupo A"), it("a1"), it("a2")],
      [it("solto 1"), it("Frase inteira que termina com ponto.")],
      [it("Grupo B"), it("b1")],
    ];
    const out = aninharPorBloco(blocos);
    const contar = (items: Item[]): number =>
      items.reduce((n, i) => n + 1 + contar(i.children), 0);
    expect(contar(out)).toBe(blocos.flat().length);
  });

  test("bloco vazio é ignorado", () => {
    expect(aninharPorBloco([[], [it("Grupo"), it("filho")]])).toHaveLength(1);
  });
});

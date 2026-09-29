import { describe, expect, test } from "bun:test";
import { blocoNaTela } from "./notion-tela";

const rt = (t: string) => [{ plain_text: t }];

describe("blocoNaTela", () => {
  test("parágrafo, título, item e caixinha viram o que a tela mostra", () => {
    expect(blocoNaTela({ id: "1", type: "paragraph", paragraph: { rich_text: rt("Oi ") } }, 0)).toEqual({ tipo: "paragrafo", texto: "Oi", nivel: 0 });
    expect(blocoNaTela({ id: "2", type: "heading_2", heading_2: { rich_text: rt("Meta") } }, 0)).toEqual({ tipo: "titulo", texto: "Meta", nivel: 0 });
    expect(blocoNaTela({ id: "3", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt("a"), } }, 1)).toEqual({ tipo: "item", texto: "a", nivel: 1 });
    expect(blocoNaTela({ id: "4", type: "to_do", to_do: { rich_text: rt("b"), checked: true } }, 0)).toEqual({ tipo: "marcar", texto: "b", marcado: true, nivel: 0 });
    expect(blocoNaTela({ id: "5", type: "divider", divider: {} }, 0)).toEqual({ tipo: "divisor", texto: "", nivel: 0 });
  });

  test("texto em vários pedaços junta; vazio e tipo desconhecido somem", () => {
    expect(blocoNaTela({ id: "6", type: "callout", callout: { rich_text: [{ plain_text: "Olha " }, { plain_text: "isso" }] } }, 0)?.texto).toBe("Olha isso");
    expect(blocoNaTela({ id: "7", type: "paragraph", paragraph: { rich_text: [] } }, 0)).toBeNull();
    expect(blocoNaTela({ id: "8", type: "image", image: {} }, 0)).toBeNull();
    expect(blocoNaTela({ id: "9", type: "child_database" }, 0)).toBeNull();
  });
});

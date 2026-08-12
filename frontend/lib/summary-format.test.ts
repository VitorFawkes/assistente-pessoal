import { describe, expect, test } from "bun:test";
import { stripBold, summaryToMarkdown, summaryToPlainText } from "./summary-format";

const RESUMO = `**Visão geral:** Conversa sobre o funil de **outbound**.

**Decisões e alinhamentos:**
- Manter a régua de 3 toques
- Site / Landing pages
  - Refazer a home
  - Trocar o formulário

**Próximos passos:**
- **Vitor:** revisar a copy
- Marcelo: fechar com o fornecedor`;

describe("stripBold", () => {
  test("tira os asteriscos e mantém o texto", () => {
    expect(stripBold("o **funil** de **outbound**")).toBe("o funil de outbound");
    expect(stripBold("sem negrito")).toBe("sem negrito");
  });
});

describe("summaryToPlainText", () => {
  const txt = summaryToPlainText(RESUMO);

  test("seção vira caixa alta e o texto dela fica na linha seguinte", () => {
    expect(txt).toContain("VISÃO GERAL\nConversa sobre o funil de outbound.");
    expect(txt).toContain("DECISÕES E ALINHAMENTOS");
    expect(txt).toContain("PRÓXIMOS PASSOS");
  });

  test("não sobra marcador de negrito em lugar nenhum", () => {
    expect(txt).not.toContain("**");
  });

  test("bullet mantém o recuo do sub-item", () => {
    expect(txt).toContain("- Site / Landing pages\n  - Refazer a home");
  });

  test("linha em branco sobrando é colapsada", () => {
    expect(txt).not.toContain("\n\n\n");
  });

  test("resumo vazio não quebra", () => {
    expect(summaryToPlainText("")).toBe("\n");
  });
});

describe("summaryToMarkdown", () => {
  const md = summaryToMarkdown(RESUMO);

  test("seção vira título de markdown", () => {
    expect(md).toContain("## Visão geral");
    expect(md).toContain("## Próximos passos");
  });

  test("texto colado no título da seção vira parágrafo próprio", () => {
    expect(md).toContain("## Visão geral\n\nConversa sobre o funil de **outbound**.");
  });

  test("bullets e negrito de dentro dos itens passam intactos", () => {
    expect(md).toContain("- Manter a régua de 3 toques");
    expect(md).toContain("  - Refazer a home");
    expect(md).toContain("- **Vitor:** revisar a copy");
  });

  test("item em negrito com dois-pontos continua item, não vira título", () => {
    expect(md).not.toContain("## Vitor");
  });
});

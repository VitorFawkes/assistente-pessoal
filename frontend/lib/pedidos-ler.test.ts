import { describe, expect, test } from "bun:test";
import { perguntasPorLinha } from "./pedidos-ler";

describe("ler arquivo sem IA (plano B)", () => {
  test("o título do documento (= nome do arquivo) não vira pergunta: vai para as linhas de fora", () => {
    const r = perguntasPorLinha(
      "Perguntas para o formulário das coberturas de casamento\nNome de quem está preenchendo\nData do casamento",
      "Perguntas para o formulário das coberturas de casamento.docx",
    );
    expect(r.perguntas.map((p) => p.rotulo)).toEqual(["Nome de quem está preenchendo", "Data do casamento"]);
    expect(r.ignoradas).toEqual(["Perguntas para o formulário das coberturas de casamento"]);
  });

  test("sem acento, maiúscula e pontuação não atrapalham; sem nome de arquivo, toda linha vira pergunta", () => {
    expect(perguntasPorLinha("PERGUNTAS PARA O FORMULARIO!\nNome do casal", "perguntas-para-o-formulário.txt").ignoradas).toEqual(["PERGUNTAS PARA O FORMULARIO!"]);
    expect(perguntasPorLinha("Briefing\nNome do casal").perguntas).toHaveLength(2);
  });
});

import { describe, expect, it } from "bun:test";
import { comProva, type Entendimento } from "./agente-entender";

const nomes = ["Vitor Gambetti", "Tiago Moreira", "Paula Klotz", "Isadora Ferens"];
const base: Entendimento = {
  resumo: "",
  tipo: "consulta",
  de_quem: "dela",
  certeza: "alta",
  oferecer: null,
  pergunta: null,
  pessoa_citada: null,
  oferta_estreita: "Quer só as que você ficou de fazer?",
  custoUsd: 0,
  segundos: 0,
};
const pessoa = (texto: string) => ({ quem: "pessoa", texto });

describe("o entendimento só estreita com prova nas palavras dela", () => {
  it("o print do Vitor (02/10/2026): o Sol leu 'só as dela' e a resposta vai com todas e a oferta", () => {
    const e = comProva(base, [pessoa("Tem algumas reuniões que falei em fazer coisas no CRM, TTARS. Algumas inclusive devem estar repetidas. Consegue compilar e me mandar aqui, por favor?")], nomes);
    expect(e.de_quem).toBe("todos");
    expect(e.oferecer).toBe("Quer só as que você ficou de fazer?");
  });

  it("'só as minhas' estreita", () => {
    expect(comProva(base, [pessoa("O que eu fiquei de fazer no TTARS? Só as minhas")], nomes).de_quem).toBe("dela");
  });

  it("o sim à oferta estreita", () => {
    const falas = [pessoa("Tudo de CRM das reuniões"), { quem: "assistente", texto: "Achei 54. Quer só as que você ficou de fazer?" }, pessoa("sim")];
    expect(comProva(base, falas, nomes).de_quem).toBe("dela");
  });

  it("o nome que ela escreveu (apelido também) estreita para a outra pessoa", () => {
    const isa = { ...base, de_quem: "de_outra_pessoa" as const, pessoa_citada: "Isa" };
    expect(comProva(isa, [pessoa("O que a Isa ficou de fazer?")], nomes).de_quem).toBe("de_outra_pessoa");
    // o nome só da resposta do Assistente não prova
    expect(comProva(isa, [pessoa("e o que ficou pendente?")], nomes).de_quem).toBe("todos");
  });

  it("mudança fica como o Sol entendeu", () => {
    expect(comProva({ ...base, tipo: "mudanca" }, [pessoa("Cancela as que falei em fazer de CRM")], nomes).de_quem).toBe("dela");
  });
});

import { describe, expect, it } from "bun:test";
import { pessoaDaAcao } from "./notion-sync";

type Acao = Parameters<typeof pessoaDaAcao>[0];
const PESSOAS = new Map(
  [
    { notion_user_id: "n-paula", nome: "Paula Klotz", email: null, user_id: "u-paula" },
    { notion_user_id: "n-fabi", nome: "Fabí", email: null, user_id: null },
  ].map((p) => [p.notion_user_id, p]),
);
const acao = (owner: string, responsavel_user_id: string | null) => ({ owner, responsavel_user_id, acao: "cobrar" }) as unknown as Acao;

describe("pessoa do Notion de uma ação", () => {
  it("quem recebeu no Ações vale pelo usuário", () => {
    expect(pessoaDaAcao(acao("Paula Klotz", "u-paula"), PESSOAS, undefined)).toBe("n-paula");
  });
  it("alguém de fora da Welcome com o primeiro nome de alguém do marketing não vira essa pessoa", () => {
    expect(pessoaDaAcao(acao("Paula", null), PESSOAS, undefined)).toBe("");
    expect(pessoaDaAcao(acao("Paula", null), PESSOAS, "n-antes")).toBe("n-antes");
  });
  it("só o nome, igual ao nome inteiro de lá, continua valendo", () => {
    expect(pessoaDaAcao(acao("Fabí", null), PESSOAS, undefined)).toBe("n-fabi");
  });
  it("passada a colega do Ações que não está no Notion: o primeiro nome ainda acha, como antes", () => {
    expect(pessoaDaAcao(acao("Paula", "u-outra"), PESSOAS, undefined)).toBe("n-paula");
  });
});

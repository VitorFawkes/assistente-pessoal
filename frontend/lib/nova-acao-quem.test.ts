import { describe, expect, it } from "bun:test";
import { quemDaFrase } from "./nova-acao";
import { acharColegaPorNome, resolverDono } from "./compartilhar";
import type { PessoaDaEquipe } from "./equipe-compartilhado";

const p = (nome: string, email: string, so_no_teams = false): PessoaDaEquipe => ({
  id: null,
  email,
  nome,
  organizacao: "Welcome Trips",
  times: [],
  usa_acoes: !so_no_teams,
  so_no_teams,
});

// 29/09/2026: as pessoas do Teams entraram na lista. "Camila" passou a ter duas; se só uma tem
// TTARS, "pedir pra Camila" continua indo para ela, como antes.
describe("quemDaFrase com as pessoas do Teams", () => {
  it("nome repetido: fica com a única que tem TTARS", () => {
    const pessoas = [p("Camila Montanhini", "camila@welcometrips.com.br"), p("Camila Girundi", "camila.g@welcometrips.com.br", true)];
    expect(quemDaFrase("Camila", pessoas)).toEqual({ quem_email: "camila@welcometrips.com.br" });
  });

  it("duas com TTARS continuam pedindo para escolher", () => {
    const pessoas = [p("Ana Tereza", "ana.t@x.com"), p("Ana Kuss", "ana@x.com"), p("Ana Teams", "ana.teams@x.com", true)];
    expect(quemDaFrase("Ana", pessoas).aviso).toContain("mais de uma pessoa");
  });

  it("só no Teams e sem outra com o nome: vai para ela", () => {
    expect(quemDaFrase("Angela", [p("Angela", "angela@welcometrips.com.br", true)])).toEqual({ quem_email: "angela@welcometrips.com.br" });
  });
});


describe("colegas com gente só no Teams", () => {
  const colegas = [
    { id: "eu", nome: "Teste" },
    { id: "cm", nome: "Camila Montanhini" },
    { id: "cg", nome: "Camila Girundi", so_no_teams: true },
    { id: "an", nome: "Angela", so_no_teams: true },
  ];
  it("primeiro nome repetido: fica com quem tem TTARS", () => {
    expect(acharColegaPorNome(colegas, "Camila")?.id).toBe("cm");
  });
  it("só no Teams e sem homônimo: acha pelo nome", () => {
    expect(acharColegaPorNome(colegas, "Angela")?.id).toBe("an");
  });
  it("passar ação para quem só está no Teams continua valendo (escolhido na tela)", () => {
    const r = resolverDono({ responsavel_user_id: "an" }, { donoId: "eu", colegas, slug: "eu" });
    expect("erro" in (r as object)).toBe(false);
  });
});

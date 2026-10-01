import { describe, expect, test } from "bun:test";
import {
  areaDoPedido,
  casalDoTitulo,
  conferirRespostas,
  descricaoAtualizada,
  descricaoDoPedido,
  ehDeFora,
  ehErro,
  ehRoboOuTeste,
  estaNoPublico,
  faltaParaPublicar,
  limparDestino,
  limparPerguntas,
  limparRascunho,
  marcasDaOrganizacao,
  pedidoEncerrado,
  pessoasDoCasal,
  prazoDoPedido,
  respostasQueMudaram,
  rotuloDaPergunta,
  situacaoDoPedido,
  situacaoEmPortugues,
  slugDe,
  textoDaResposta,
  timeNoPublico,
  tituloDoPedido,
  type Destino,
  type Pergunta,
} from "./pedidos-tipos";
import { propriedadesPara, lerPagina, trocarPrimeiraPessoa, type PaginaNotion } from "./notion-mapa";

const P = (x: Partial<Pergunta> & Pick<Pergunta, "id" | "tipo" | "rotulo">): Pergunta => ({ obrigatoria: false, aceita_nao_temos: false, ...x });

describe("quem pode pedir", () => {
  const ww = { tipo: "empresas" as const, empresas: ["Welcome Weddings"], times: [] };
  test("empresa na lista do TTARS (várias separadas por vírgula)", () => {
    expect(estaNoPublico({ organizacao: "Welcome Trips, Welcome Weddings", times: [] }, ww)).toBe(true);
    expect(estaNoPublico({ organizacao: "Welcome Trips", times: [] }, ww)).toBe(false);
    expect(estaNoPublico(null, ww)).toBe(false);
  });
  test("quem só está no Teams entra só em Toda a Welcome", () => {
    expect(estaNoPublico({ organizacao: "Teams · Welcome Weddings", times: [] }, ww)).toBe(false);
    expect(estaNoPublico({ organizacao: "Teams · Welcome Weddings", times: [] }, { tipo: "todos", empresas: [], times: [] })).toBe(true);
  });
  test("times", () => {
    const pub = { tipo: "times" as const, empresas: [], times: [{ id: "t-plan", nome: "Planejamento" }] };
    expect(estaNoPublico({ organizacao: "Welcome Weddings", times: [{ id: "t-plan" }] }, pub)).toBe(true);
    expect(estaNoPublico({ organizacao: "Welcome Weddings", times: [{ id: "t-g2" }] }, pub)).toBe(false);
    expect(timeNoPublico({ id: "t-x", organizacao: "Welcome Weddings" }, ww)).toBe(true);
    expect(timeNoPublico({ id: "t-x", organizacao: "Welcome Trips" }, ww)).toBe(false);
  });
  test("robôs e contas de teste não contam", () => {
    expect(ehRoboOuTeste("sarah.ia@welcomeweddings.com.br")).toBe(true);
    expect(ehRoboOuTeste("test@welcomecrm.test")).toBe(true);
    expect(ehRoboOuTeste("diana@welcomeweddings.com.br")).toBe(false);
  });
  test("de fora da Welcome (o Robson) não conta", () => {
    expect(ehDeFora("robson@growthway.online")).toBe(true);
    expect(ehDeFora("diana@welcomeweddings.com.br")).toBe(false);
    expect(ehDeFora("Paula@WelcomeTrips.com.br")).toBe(false);
  });
});

describe("perguntas", () => {
  test("tipo inexistente e texto vazio recusam; ids repetidos ganham outro", () => {
    expect(ehErro(limparPerguntas([{ tipo: "cor", rotulo: "x" }]))).toBe(true);
    expect(ehErro(limparPerguntas([{ tipo: "texto", rotulo: "  " }]))).toBe(true);
    const ps = limparPerguntas([
      { id: "a", tipo: "texto", rotulo: "Um" },
      { id: "a", tipo: "texto", rotulo: "Dois" },
    ]);
    expect(ehErro(ps) ? [] : ps.map((p) => p.id)).toEqual(["a", "a-2"]);
  });
  test("publicar pede pergunta, quem recebe, empresa e opções", () => {
    const r = limparRascunho({ nome: "Pedido", perguntas: [{ tipo: "escolha_unica", rotulo: "Qual?", opcoes: ["A"] }], publico: { tipo: "empresas", empresas: ["Welcome Weddings"] }, destino: { quem_email: "fabiola@welcometrips.com.br" } });
    expect(!ehErro(r) && faltaParaPublicar(r)).toContain("2 opções");
    const vazio = limparRascunho({ nome: "Pedido" });
    expect(!ehErro(vazio) && faltaParaPublicar(vazio)).toBe("Ponha pelo menos uma pergunta.");
    expect(ehErro(limparDestino({ quem_email: "" }, true))).toBe(true);
    expect(ehErro(limparDestino({ prazo: { tipo: "dias", dias: 400 } }, false))).toBe(true);
  });
});

describe("respostas", () => {
  const perguntas = [
    P({ id: "quem", tipo: "automatico_quem_pede", rotulo: "Quem" }),
    P({ id: "casamento", tipo: "casamento", rotulo: "Casamento", obrigatoria: true }),
    P({ id: "data", tipo: "data", rotulo: "Data", obrigatoria: true, preenche: "data_casamento" }),
    P({ id: "ig", tipo: "instagram", rotulo: "Instagram", obrigatoria: true, aceita_nao_temos: true }),
    P({ id: "rel", tipo: "paragrafo", rotulo: "Relacionamento", obrigatoria: true }),
    P({ id: "story", tipo: "sim_nao", rotulo: "Storymaker?", obrigatoria: true }),
  ];
  const certas = { data: { valor: "2026-11-22" }, ig: { valor: null, nao_temos: true }, rel: { valor: "Ótimo" }, story: { valor: false } };
  test("obrigatória, 'ainda não temos' só onde aceita e o servidor preenche quem e casamento", () => {
    const r = conferirRespostas(perguntas, { ...certas, quem: { valor: "Outra pessoa" } }, { quem: "Diana", casamento: "DW | Lucas e William" });
    expect(ehErro(r)).toBe(false);
    if (ehErro(r)) return;
    expect(r.quem.valor).toBe("Diana");
    expect(r.casamento.valor).toBe("DW | Lucas e William");
    expect(ehErro(conferirRespostas(perguntas, { ...certas, rel: { valor: " " } }, { quem: "D", casamento: "c" }))).toBe(true);
    expect(ehErro(conferirRespostas(perguntas, { ...certas, rel: { valor: null, nao_temos: true } }, { quem: "D", casamento: "c" }))).toBe(true);
    expect(ehErro(conferirRespostas(perguntas, certas, { quem: "D", casamento: null }))).toBe(true);
    expect(ehErro(conferirRespostas(perguntas, { ...certas, data: { valor: "22/11" } }, { quem: "D", casamento: "c" }))).toBe(true);
    expect(ehErro(conferirRespostas(perguntas, { ...certas, story: { valor: "sim" } }, { quem: "D", casamento: "c" }))).toBe(true);
  });
  test("texto de cada resposta e a descrição", () => {
    const r = conferirRespostas(perguntas, certas, { quem: "Diana", casamento: "DW | Lucas e William" });
    if (ehErro(r)) throw new Error(r.erro);
    expect(textoDaResposta(perguntas[2], r.data)).toBe("22/11/2026");
    expect(textoDaResposta(perguntas[3], r.ig)).toBe("ainda não temos");
    expect(textoDaResposta(perguntas[5], r.story)).toBe("Não");
    expect(textoDaResposta(perguntas[1], r.casamento)).toBe("Lucas e William");
    // Sem pergunta de nome do casal: o casamento fica (sem o prefixo do quadro); quem preenche não repete.
    expect(descricaoDoPedido(perguntas, r, "Diana", "30/09", "DW | Lucas e William").split("\n")).toEqual([
      "Pedido por Diana pelo TTARS, 30/09",
      "Casamento: Lucas e William",
      "Data: 22/11/2026",
      "Instagram: ainda não temos",
      "Relacionamento: Ótimo",
      "Storymaker: Não",
    ]);
    const varias = descricaoDoPedido([P({ id: "f", tipo: "paragrafo", rotulo: "Fornecedores" })], { f: { valor: "@foto\n\n  @dj  " } }, "Diana", "30/09");
    expect(varias.split("\n")[1]).toBe("Fornecedores: @foto · @dj");
  });
  test("título pelo modelo e casal sem prefixo do quadro", () => {
    expect(casalDoTitulo("DW | Lucas e William")).toBe("Lucas e William");
    expect(casalDoTitulo("DW l Ana e Bia")).toBe("Ana e Bia");
    expect(casalDoTitulo("W - Rê e Mar")).toBe("Rê e Mar");
    expect(casalDoTitulo("Elopement | Ju e Lu")).toBe("Ju e Lu");
    expect(casalDoTitulo("EW | Bia  e  Caio")).toBe("Bia e Caio");
    expect(casalDoTitulo("Weslley e Ana")).toBe("Weslley e Ana");
    expect(tituloDoPedido("Cobertura I {casal} I Pedido", { casal: "Lucas e William", quem: "Diana", nomeDoFormulario: "Cobertura" })).toBe(
      "Cobertura I Lucas e William I Pedido",
    );
    expect(tituloDoPedido("", { casal: null, quem: "Diana", nomeDoFormulario: "Cobertura" })).toBe("Cobertura");
  });
  test("Instagram de cada pessoa do casal e a descrição da cobertura (Tela 4)", () => {
    expect(pessoasDoCasal("Lucas e William")).toEqual(["Lucas", "William"]);
    expect(pessoasDoCasal("Ana & Bia")).toEqual(["Ana", "Bia"]);
    expect(pessoasDoCasal("Casamento da Ana")).toBeNull();
    // O que vem entre parênteses não é nome ("(exemplo)" virava "Instagram de Bruno (exemplo)").
    expect(pessoasDoCasal("Ana e Bruno (exemplo)")).toEqual(["Ana", "Bruno"]);
    const ig = P({ id: "i2", tipo: "instagram", rotulo: "Instagram do noivo", pessoa: 2 });
    expect(rotuloDaPergunta(ig, ["Lucas", "William"])).toBe("Instagram de William");
    expect(rotuloDaPergunta(ig, null)).toBe("Instagram do noivo");
    const cobertura = [
      P({ id: "quem", tipo: "automatico_quem_pede", rotulo: "Nome de quem está preenchendo" }),
      P({ id: "casamento", tipo: "casamento", rotulo: "Casamento", obrigatoria: true }),
      P({ id: "casal", tipo: "texto", rotulo: "Nome do casal", preenche: "casal" }),
      P({ id: "i1", tipo: "instagram", rotulo: "Instagram da noiva", aceita_nao_temos: true, preenche: "instagram", pessoa: 1 }),
      P({ id: "i2", tipo: "instagram", rotulo: "Instagram do noivo", aceita_nao_temos: true, preenche: "instagram", pessoa: 2 }),
      P({ id: "nm", tipo: "paragrafo", rotulo: "O que não devemos mostrar?" }),
      P({ id: "st", tipo: "sim_nao", rotulo: "Será necessário storymaker?" }),
    ];
    const r = { quem: { valor: "Diana" }, casamento: { valor: "DW | Lucas e William" }, casal: { valor: "Lucas e William" }, i1: { valor: null, nao_temos: true }, i2: { valor: null, nao_temos: true }, nm: { valor: "nada" }, st: { valor: true } };
    expect(descricaoDoPedido(cobertura, r, "Diana Parigot", "30/09", "DW | Lucas e William").split("\n")).toEqual([
      "Pedido por Diana Parigot pelo TTARS, 30/09",
      "Nome do casal: Lucas e William",
      "Instagram de Lucas: ainda não temos",
      "Instagram de William: ainda não temos",
      "O que não devemos mostrar: nada",
      "Será necessário storymaker: Sim",
    ]);
  });
  test("situação crua (a tela traduz) e o texto do repetido", () => {
    expect(situacaoDoPedido("aberta", "Not started")).toBe("Not started");
    expect(situacaoDoPedido("em_andamento", "This Week")).toBe("This Week");
    expect(situacaoDoPedido("aberta", null)).toBe("Not started");
    expect(situacaoDoPedido("em_andamento", null)).toBe("In progress");
    expect(situacaoDoPedido("cancelada", "Not started")).toBe("cancelada");
    expect(situacaoEmPortugues("This Week")).toBe("Esta semana");
    expect(situacaoEmPortugues("Done")).toBe("Feito");
    expect(situacaoEmPortugues("cancelada")).toBe("Cancelado");
    // As outras situações da base do marketing (29/09), iguais à tela do TTARS.
    expect(situacaoEmPortugues("To Day")).toBe("Hoje");
    expect(situacaoEmPortugues("Daily")).toBe("Todo dia");
    expect(situacaoEmPortugues("Locked")).toBe("Travada");
    expect(slugDe("Cobertura de Casamento!")).toBe("cobertura-de-casamento");
  });
});

describe("Notion: Person e Assign no pedido", () => {
  test("com assign, a pessoa vai nas duas colunas; sem, só no Person (como sempre)", () => {
    expect(propriedadesPara({ pessoa: "n-fabi" }, { assign: true })).toEqual({ Person: { people: [{ id: "n-fabi" }] }, Assign: { people: [{ id: "n-fabi" }] } });
    expect(propriedadesPara({ pessoa: "n-fabi" })).toEqual({ Person: { people: [{ id: "n-fabi" }] } });
  });
  test("a 1ª do Assign fica à parte (o pedido lê ela antes do Person)", () => {
    const pg: PaginaNotion = {
      id: "pg",
      last_edited_time: "2026-09-30T12:00:00Z",
      properties: {
        Person: { type: "people", people: [{ id: "n-fabi", name: "Fabí" }] },
        Assign: { type: "people", people: [{ id: "n-angela", name: "Angela" }] },
      },
    };
    const p = lerPagina(pg);
    expect(p.pessoa).toBe("n-fabi");
    expect(p.assign).toBe("n-angela");
  });
});

describe("sem limites (01/10/2026)", () => {
  const destino = (x: Record<string, unknown>): Destino => {
    const d = limparDestino(x, false);
    if (ehErro(d)) throw new Error(d.erro);
    return d;
  };

  test("quem recebe: lista na ordem, em minúsculas e sem repetir; o 1º continua em quem_email", () => {
    const d = destino({ quem_emails: ["Fabiola@WelcomeTrips.com.br", "angela@welcometrips.com.br", "fabiola@welcometrips.com.br", " "] });
    expect(d.quem_emails).toEqual(["fabiola@welcometrips.com.br", "angela@welcometrips.com.br"]);
    expect(d.quem_email).toBe("fabiola@welcometrips.com.br");
    expect(ehErro(limparDestino({ quem_emails: ["fabiola"] }, false))).toBe(true);
    expect(ehErro(limparDestino({ quem_emails: Array.from({ length: 11 }, (_, i) => `p${i}@welcometrips.com.br`) }, false))).toBe(true);
    expect(destino({ quem_emails: Array.from({ length: 10 }, (_, i) => `p${i}@welcometrips.com.br`) }).quem_emails).toHaveLength(10);
    expect(ehErro(limparDestino({ quem_emails: [] }, true))).toBe(true);
  });

  test("formulário antigo (só quem_email) vira lista de uma pessoa; com os dois, a lista vale", () => {
    expect(destino({ quem_email: "Fabiola@welcometrips.com.br" }).quem_emails).toEqual(["fabiola@welcometrips.com.br"]);
    expect(destino({}).quem_emails).toEqual([]);
    expect(destino({ quem_email: "x@welcometrips.com.br", quem_emails: ["y@welcometrips.com.br"] }).quem_emails).toEqual(["y@welcometrips.com.br"]);
  });

  test("um pedido por casamento: padrão sim; desligado fica desligado", () => {
    expect(destino({}).um_por_casamento).toBe(true);
    expect(destino({ um_por_casamento: false }).um_por_casamento).toBe(false);
    expect(destino({ um_por_casamento: "nao" }).um_por_casamento).toBe(true);
  });

  test("área da marca de quem pede", () => {
    expect(destino({ bu: "quem_pede" }).bu).toBe("quem_pede");
    expect(destino({ bu: "Qualquer" }).bu).toBe("Institucional");
    expect(marcasDaOrganizacao("Welcome Trips, Welcome Weddings")).toEqual(["Trips", "Weddings"]);
    expect(marcasDaOrganizacao("Welcome Weddings, Welcome Corporativo, Welcome Weddings")).toEqual(["Weddings", "Corp"]);
    expect(marcasDaOrganizacao("Welcome Trips, Welcome Group")).toEqual(["Trips"]);
    expect(marcasDaOrganizacao("Teams · Welcome Trips")).toEqual(["Trips"]);
    expect(marcasDaOrganizacao("Welcome Group")).toEqual([]);
    expect(marcasDaOrganizacao(null)).toEqual([]);
    // Área fixa do formulário: a escolha de quem pede não conta.
    expect(areaDoPedido("Weddings", ["Trips"], "Trips")).toBe("Weddings");
    expect(areaDoPedido("quem_pede", [], undefined)).toBe("Institucional");
    expect(areaDoPedido("quem_pede", ["Trips"], "Weddings")).toBe("Trips");
    expect(areaDoPedido("quem_pede", ["Trips", "Weddings"], "Weddings")).toBe("Weddings");
    const semEscolha = areaDoPedido("quem_pede", ["Trips", "Weddings"], undefined);
    expect(ehErro(semEscolha) && semEscolha.erro).toBe("Escolha a área do pedido: Trips ou Weddings.");
    expect(ehErro(areaDoPedido("quem_pede", ["Trips", "Weddings"], "Corp"))).toBe(true);
  });

  const comData = [
    P({ id: "quando", tipo: "data", rotulo: "Para quando?", obrigatoria: true }),
    P({ id: "talvez", tipo: "data", rotulo: "Data opcional" }),
    P({ id: "oque", tipo: "texto", rotulo: "O que precisa?", obrigatoria: true }),
  ];
  const rascunho = (prazo: Record<string, unknown>) => {
    const r = limparRascunho({ nome: "Arte", perguntas: comData, publico: { tipo: "todos" }, destino: { quem_emails: ["angela@welcometrips.com.br"], prazo } });
    if (ehErro(r)) throw new Error(r.erro);
    return r;
  };

  test("prazo pela pergunta: publicar confere que ela existe, é de data e é obrigatória", () => {
    expect(rascunho({ tipo: "pergunta", pergunta_id: "quando" }).destino.prazo).toEqual({ tipo: "pergunta", pergunta_id: "quando" });
    expect(rascunho({ tipo: "pergunta" }).destino.prazo).toEqual({ tipo: "pergunta", pergunta_id: "" });
    expect(faltaParaPublicar(rascunho({ tipo: "pergunta", pergunta_id: "quando" }))).toBeNull();
    expect(faltaParaPublicar(rascunho({ tipo: "pergunta" }))).toBe("Escolha a pergunta de data que vira o prazo.");
    expect(faltaParaPublicar(rascunho({ tipo: "pergunta", pergunta_id: "sumiu" }))).toBe("Escolha a pergunta de data que vira o prazo.");
    expect(faltaParaPublicar(rascunho({ tipo: "pergunta", pergunta_id: "oque" }))).toContain("não é uma pergunta de data");
    expect(faltaParaPublicar(rascunho({ tipo: "pergunta", pergunta_id: "talvez" }))).toContain("precisa ser obrigatória");
    const semQuem = limparRascunho({ nome: "Arte", perguntas: comData, publico: { tipo: "todos" }, destino: { quem_emails: [] } });
    expect(!ehErro(semQuem) && faltaParaPublicar(semQuem)).toBe("Escolha a pessoa do marketing que recebe o pedido.");
  });

  test("o prazo da ação: dia do casamento, dias, a data respondida ou sem", () => {
    const agora = new Date("2026-10-01T15:00:00Z");
    const r = { quando: { valor: "2026-10-20" }, oque: { valor: "Arte" } };
    expect(prazoDoPedido(destino({ prazo: { tipo: "pergunta", pergunta_id: "quando" } }), comData, r, agora)).toBe("2026-10-20");
    expect(prazoDoPedido(destino({ prazo: { tipo: "pergunta", pergunta_id: "talvez" } }), comData, r, agora)).toBeNull();
    expect(prazoDoPedido(destino({ prazo: { tipo: "dias", dias: 5 } }), comData, r, agora)).toBe("2026-10-06");
    expect(prazoDoPedido(destino({ prazo: { tipo: "sem" } }), comData, r, agora)).toBeNull();
    const casamento = [P({ id: "data", tipo: "data", rotulo: "Data", preenche: "data_casamento" })];
    expect(prazoDoPedido(destino({ prazo: { tipo: "data_casamento" } }), casamento, { data: { valor: "2026-11-22" } }, agora)).toBe("2026-11-22");
  });

  test("encerrado = feito ou cancelado (aqui ou Done no Notion)", () => {
    expect(pedidoEncerrado("aberta", "Not started")).toBe(false);
    expect(pedidoEncerrado("em_andamento", "This Week")).toBe(false);
    expect(pedidoEncerrado("concluida", null)).toBe(true);
    expect(pedidoEncerrado("cancelada", "Not started")).toBe(true);
    expect(pedidoEncerrado("em_andamento", "Done")).toBe(true);
  });

  const cobertura = [
    P({ id: "quem", tipo: "automatico_quem_pede", rotulo: "Nome de quem está preenchendo" }),
    P({ id: "casamento", tipo: "casamento", rotulo: "Casamento", obrigatoria: true }),
    P({ id: "casal", tipo: "texto", rotulo: "Nome do casal", preenche: "casal" }),
    P({ id: "i1", tipo: "instagram", rotulo: "Instagram da noiva", aceita_nao_temos: true, pessoa: 1 }),
    P({ id: "contato", tipo: "telefone_email", rotulo: "Contato da assessora", obrigatoria: true, aceita_nao_temos: true }),
  ];
  const antes = {
    quem: { valor: "Diana Parigot" },
    casamento: { valor: "DW | Lucas e William" },
    casal: { valor: "Lucas e William" },
    i1: { valor: null, nao_temos: true },
    contato: { valor: null, nao_temos: true },
  };
  const depois = { ...antes, i1: { valor: "@lucas" }, contato: { valor: "+1 809 555 0000" } };
  const velha = descricaoDoPedido(cobertura, antes, "Diana Parigot", "28/09", "DW | Lucas e William");

  test("completar: o que mudou, com o rótulo que quem lê vê", () => {
    expect(respostasQueMudaram(cobertura, antes, depois, "DW | Lucas e William")).toEqual(["Instagram de Lucas", "Contato da assessora"]);
    expect(respostasQueMudaram(cobertura, antes, { ...antes, quem: { valor: "Outra" } }, "DW | Lucas e William")).toEqual([]);
  });

  test("completar: a descrição é refeita com o dia do pedido; o que alguém escreveu não se perde", () => {
    const nova = descricaoAtualizada(velha, cobertura, antes, depois, "Diana Parigot", "28/09", "DW | Lucas e William");
    expect(nova.split("\n")).toEqual([
      "Pedido por Diana Parigot pelo TTARS, 28/09",
      "Nome do casal: Lucas e William",
      "Instagram de Lucas: @lucas",
      "Contato da assessora: +1 809 555 0000",
    ]);
    expect(nova).toBe(descricaoDoPedido(cobertura, depois, "Diana Parigot", "28/09", "DW | Lucas e William"));
    // Nota do marketing depois do bloco (coluna Text do Notion): fica.
    expect(descricaoAtualizada(`${velha}\n\nnota da Fabí`, cobertura, antes, depois, "Diana Parigot", "28/09", "DW | Lucas e William")).toBe(`${nova}\n\nnota da Fabí`);
    // O bloco foi mexido: troca só as linhas que mudaram; o resto (e a mexida) fica.
    const mexida = velha.replace("Nome do casal: Lucas e William", "Nome do casal: Lucas e William (confirmado com a Fabí)") + "\nobs: ligar antes";
    expect(descricaoAtualizada(mexida, cobertura, antes, depois, "Diana Parigot", "28/09", "DW | Lucas e William").split("\n")).toEqual([
      "Pedido por Diana Parigot pelo TTARS, 28/09",
      "Nome do casal: Lucas e William (confirmado com a Fabí)",
      "Instagram de Lucas: @lucas",
      "Contato da assessora: +1 809 555 0000",
      "obs: ligar antes",
    ]);
    // A linha da resposta foi apagada por alguém: a nova vai no fim.
    const semContato = velha.replace("\nContato da assessora: ainda não temos", "");
    expect(descricaoAtualizada(semContato, cobertura, antes, depois, "Diana Parigot", "28/09", "DW | Lucas e William").split("\n").at(-1)).toBe(
      "Contato da assessora: +1 809 555 0000",
    );
    expect(descricaoAtualizada(null, cobertura, antes, depois, "Diana Parigot", "28/09", "DW | Lucas e William")).toBe(nova);
  });
});

describe("Notion: várias pessoas no pedido (01/10/2026)", () => {
  const dois = { people: [{ id: "n-fabi" }, { id: "n-angela" }] };
  test("a página nasce com todas, na ordem, em Person e Assign", () => {
    expect(propriedadesPara({ pessoa: "n-fabi" }, { assign: true, pessoas: ["n-fabi", "n-angela"] })).toEqual({ Person: dois, Assign: dois });
    // Página comum: uma pessoa, só no Person (como sempre).
    expect(propriedadesPara({ pessoa: "n-fabi" }, { pessoas: [] })).toEqual({ Person: { people: [{ id: "n-fabi" }] } });
    expect(propriedadesPara({ pessoa: "" }, { assign: true, pessoas: ["n-fabi"] })).toEqual({ Person: { people: [] }, Assign: { people: [] } });
  });
  test("outro campo mudando não regrava as pessoas", () => {
    expect(propriedadesPara({ status: "em_andamento", prioridade: "urgente" }, { assign: true, pessoas: ["n-fabi", "n-angela"] })).toEqual({
      Status: { status: { name: "This Week" } },
      Priority: { select: { name: "Urgent" } },
    });
  });
  test("só a 1ª muda; as outras ficam, na ordem", () => {
    expect(trocarPrimeiraPessoa(["n-fabi", "n-angela", "n-ju"], "n-paula")).toEqual(["n-paula", "n-angela", "n-ju"]);
    expect(trocarPrimeiraPessoa(["n-fabi", "n-angela"], "n-angela")).toEqual(["n-angela"]);
    expect(trocarPrimeiraPessoa([], "n-paula")).toEqual(["n-paula"]);
    expect(trocarPrimeiraPessoa(["n-fabi", "n-angela"], "")).toEqual([]);
  });
  test("a leitura guarda a lista de cada coluna", () => {
    const p = lerPagina({
      id: "pg",
      last_edited_time: "2026-10-01T12:00:00Z",
      properties: {
        Person: { type: "people", people: [{ id: "n-fabi" }, { id: "n-angela" }] },
        Assign: { type: "people", people: [{ id: "n-angela" }, { id: "n-fabi" }] },
      },
    });
    expect(p.listaPerson).toEqual(["n-fabi", "n-angela"]);
    expect(p.listaAssign).toEqual(["n-angela", "n-fabi"]);
    expect(p.assign).toBe("n-angela");
  });
});

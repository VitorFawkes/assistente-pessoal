import { describe, expect, it } from "bun:test";
import {
  anotarNaTela,
  desfazerQuem,
  ditoPelaPessoa,
  idsDasFalas,
  limitaPorPessoa,
  loteSemSim,
  limparRefs,
  linhaCorrida,
  linhaDoRetrato,
  montarMudanca,
  precisaConfirmar,
  quandoVence,
  quemFazNaTela,
  type TarefaVista,
} from "./agente-regras";
import { paraQuemVe } from "./compartilhar";

function t(over: Partial<TarefaVista> = {}): TarefaVista {
  return {
    id: "11111111-1111-1111-1111-111111111111", user_id: "u1", meeting_id: null, titulo: "Revisar orçamento",
    descricao: null, owner: "eu", is_mine: true, acao: "executar", prazo: "2026-10-02T02:59:00.000Z", inicio: null,
    prazo_text: null, prioridade: "media", status: "aberta", evidencia: null, depende_de: null, frente: null,
    frente_proposta: null, frentes: [], pessoas: [], anexos: [], created_at: "2026-09-25T12:00:00Z",
    updated_at: "2026-09-25T12:00:00Z", concluida_em: null, cancelada_em: null, situacao_desde: null,
    precisa_revisao: false, ordem: null, no_plano: false, parece_com_id: null,
    ...over,
  } as unknown as TarefaVista;
}

const NADA = { titulo: null, descricao: null, prazo: null, prioridade: null, situacao: null };

describe("retrato", () => {
  it("mostra o prazo no dia de Brasília e quem faz do ponto de vista de quem vê", () => {
    const l = linhaDoRetrato("t1", t());
    expect(l).toMatchObject({ ref: "t1", quem_faz: "você", tipo: "eu faço", prazo: "2026-10-01", situacao: "aberta" });
    const cobrada = t({ acao: "cobrar", owner: "Paula Klotz", pessoas: [{ nome: "Paula Klotz", principal: true } as never] });
    expect(quemFazNaTela(cobrada)).toBe("Paula Klotz");
    expect(linhaDoRetrato("t2", t({ compartilhada: true, criador_nome: "Vitor" }))).toMatchObject({ criada_por: "Vitor" });
  });
});

describe("montarMudanca", () => {
  it("prazo vira o fim do dia em Brasília e o desfazer guarda o anterior", () => {
    const r = montarMudanca(t(), { ...NADA, prazo: "2026-10-09" });
    if ("erro" in r) throw new Error(r.erro);
    expect(r.corpo).toEqual({ prazo: "2026-10-10T02:59:00.000Z", prazo_text: null });
    expect(r.desfazer).toEqual({ prazo: "2026-10-02T02:59:00.000Z", prazo_text: null });
    expect(r.partes[0]).toContain("09/10");
  });

  it("remover prazo, concluir e mudar prioridade", () => {
    const r = montarMudanca(t(), { ...NADA, prazo: "remover", situacao: "concluida", prioridade: "alta" });
    if ("erro" in r) throw new Error(r.erro);
    expect(r.corpo).toMatchObject({ prazo: null, status: "concluida", prioridade: "alta" });
    expect(r.desfazer).toMatchObject({ status: "aberta", prioridade: "media" });
  });

  it("recusa valor inválido e ignora o que não muda", () => {
    expect(montarMudanca(t(), { ...NADA, prazo: "sexta" })).toEqual({ erro: "prazo inválido: sexta" });
    expect(montarMudanca(t(), { ...NADA, prioridade: "altissima" })).toEqual({ erro: "prioridade inválida: altissima" });
    const igual = montarMudanca(t(), { ...NADA, titulo: "Revisar orçamento", situacao: "aberta" });
    if ("erro" in igual) throw new Error(igual.erro);
    expect(igual.corpo).toEqual({});
  });
});

describe("precisaConfirmar (28/09: pedir já é a autorização)", () => {
  it("ação de outra pessoa muda na hora: concluir, prazo, prioridade, título", () => {
    for (const corpo of [{ status: "concluida" }, { prazo: "x", prazo_text: null }, { prioridade: "alta" }, { titulo: "Novo" }]) {
      expect(precisaConfirmar(t({ compartilhada: true }), corpo)).toBe(false);
    }
  });
  it("minha muda na hora, inclusive quem faz e muitas de uma vez", () => {
    expect(precisaConfirmar(t(), { status: "concluida" })).toBe(false);
    expect(precisaConfirmar(t(), { responsavel_email: "ana@welcome.com.br" })).toBe(false);
    expect(precisaConfirmar(t(), { owner: "Fornecedor", acao: "cobrar", responsavel_user_id: null })).toBe(false);
  });
  it("só trocar quem faz numa ação de outra pessoa espera Confirmar: o Desfazer não alcançaria", () => {
    expect(precisaConfirmar(t({ compartilhada: true }), { responsavel_email: "ana@welcome.com.br" })).toBe(true);
    expect(precisaConfirmar(t({ compartilhada: true }), { acao: "executar" })).toBe(true);
  });
});

describe("desfazerQuem", () => {
  it("volta dono, ação e responsável como estavam", () => {
    expect(desfazerQuem(t({ acao: "cobrar", owner: "Paula Klotz", responsavel_user_id: "u-paula" }))).toEqual({
      owner: "Paula Klotz", acao: "cobrar", responsavel_user_id: "u-paula",
    });
    expect(desfazerQuem(t())).toEqual({ owner: "eu", acao: "executar", responsavel_user_id: null });
  });
});

describe("quandoVence", () => {
  // 26/09/2026 é sábado; o prazo vale o dia de Brasília (23:59 BRT = 02:59Z do dia seguinte).
  const fim = (dia: string) => new Date(`${dia}T23:59:00-03:00`).toISOString();
  it("conta pelo dia de Brasília", () => {
    expect(quandoVence(fim("2026-09-26"), "2026-09-26")).toBe("hoje");
    expect(quandoVence(fim("2026-09-24"), "2026-09-26")).toBe("atrasada 2 dias");
    expect(quandoVence(fim("2026-09-25"), "2026-09-26")).toBe("atrasada 1 dia");
    expect(quandoVence(fim("2026-09-27"), "2026-09-26")).toBe("amanhã");
    expect(quandoVence(fim("2026-10-02"), "2026-09-26")).toBe("semana que vem");
    expect(quandoVence(fim("2026-10-05"), "2026-09-26")).toBe("depois");
    expect(quandoVence(fim("2026-10-01"), "2026-09-28")).toBe("esta semana");
    expect(quandoVence(null, "2026-09-26")).toBeNull();
  });
});

describe("dono do ponto de vista de quem pergunta (02/10/2026)", () => {
  it("o 'eu' de quem gravou a reunião de um colega é de quem gravou, não 'você'", () => {
    const ANA = "a0000000-0000-0000-0000-000000000001";
    const VITOR = "b0000000-0000-0000-0000-000000000002";
    const nomes = new Map([[ANA, "Ana Carolina Kuss"], [VITOR, "Vitor Gambetti"]]);
    const daAna = t({ user_id: ANA, owner: "eu", acao: "executar", meeting_id: "m1", meeting_nome: "Regua de Convidados" } as never);
    expect(quemFazNaTela(daAna)).toBe("você"); // a linha crua do banco: era o erro
    const vista = paraQuemVe(daAna, { viewerId: VITOR, slug: "eu", nomes, veReuniao: true }) as TarefaVista;
    expect(linhaDoRetrato("t9", vista)).toMatchObject({ quem_faz: "Ana Carolina Kuss", tipo: "da lista de quem criou", criada_por: "Ana Carolina Kuss" });
    // O "cobrar" que a Ana faz do Mateus também não vira "eu cobro" para o Vitor.
    const anaCobraMateus = paraQuemVe({ ...daAna, owner: "Mateus", acao: "cobrar" } as never, { viewerId: VITOR, slug: "eu", nomes }) as TarefaVista;
    expect(linhaDoRetrato("t10", anaCobraMateus)).toMatchObject({ quem_faz: "Mateus", tipo: "da lista de quem criou" });
    expect(linhaDoRetrato("t11", { ...anaCobraMateus, faco_tambem: true })).toMatchObject({ tipo: "faço junto" });
    expect(quemFazNaTela({ ...daAna, compartilhada: true, is_mine: false })).toBe("a definir");
    const passadaAoVitor = paraQuemVe({ ...daAna, owner: "Vitor", acao: "cobrar", responsavel_user_id: VITOR } as never, { viewerId: VITOR, slug: "eu", nomes }) as TarefaVista;
    expect(linhaDoRetrato("t12", passadaAoVitor)).toMatchObject({ quem_faz: "você", tipo: "eu faço" });
  });
});

describe("memória entre perguntas", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  it("junta os ids do que apareceu com as respostas, os mais novos primeiro, sem repetir", () => {
    const falas = [
      { quem: "pessoa", texto: "oi", acoes: [C] },
      { quem: "assistente", texto: "3 ações", acoes: [A, B] },
      { quem: "pessoa", texto: "manda todas" },
      { quem: "assistente", texto: "22 ações", acoes: [C, A, "t3", 7, "não é id"] },
    ];
    expect(idsDasFalas(falas)).toEqual([C, A, B]);
    expect(idsDasFalas(falas, 2)).toEqual([C, A]);
    expect(idsDasFalas([{ quem: "assistente", texto: "x", acoes: [A.toUpperCase()] }])).toEqual([A]);
    expect(idsDasFalas([{ quem: "assistente", texto: "x" }])).toEqual([]);
  });
  it("a marca do que estava na tela vai para o modelo e nunca volta para a pessoa", () => {
    expect(anotarNaTela("Achei 2.", ["t4", "t9"])).toBe("Achei 2.\n[na tela: t4, t9]");
    expect(anotarNaTela("Achei 0.", [])).toBe("Achei 0.");
    expect(limparRefs("Achei 2 (t4, t9).\n[na tela: t4, t9]")).toBe("Achei 2.");
    expect(limparRefs("Achei 1 (na tela: t1).")).toBe("Achei 1.");
    expect(limparRefs("Revisar o contrato [t3] até sexta")).toBe("Revisar o contrato até sexta");
    expect(limparRefs("Fale com a Paula (do marketing)")).toBe("Fale com a Paula (do marketing)");
  });
});

describe("linha corrida do acervo (02/10/2026)", () => {
  it("junta os campos numa linha e diz 'você' quando quem faz é quem pergunta", () => {
    const daReuniaoDoTiago = t({ acao: "cobrar", owner: "Vitor", is_mine: false, compartilhada: true, criador_nome: "Tiago", reuniao_rotulo: "Daily Noix" } as never);
    const l = linhaDoRetrato("t7", daReuniaoDoTiago, "2026-10-02", true);
    expect(l.quem_faz).toBe("você");
    expect(linhaCorrida(l, "Fazer o TARS usar a estimativa provável")).toBe(
      "t7 | Revisar orçamento | quem faz: você (da lista de quem criou) | prazo 2026-10-01, atrasada 1 dia | reunião: Daily Noix | lista de Tiago | detalhe: Fazer o TARS usar a estimativa provável",
    );
    expect(linhaDoRetrato("t7", daReuniaoDoTiago, "2026-10-02").quem_faz).toBe("Vitor");
  });
});

describe("papel (02/10/2026)", () => {
  it("eu cobro / só aguardo / eu faço viram a ação do banco e o Desfazer volta quem fazia", () => {
    const cobrada = t({ acao: "cobrar", owner: "Paula Klotz" });
    const r = montarMudanca(cobrada, { ...NADA, papel: "só aguardo" });
    expect(r).toMatchObject({ corpo: { acao: "aguardar" }, desfazer: { acao: "cobrar", owner: "Paula Klotz" }, partes: ["só aguardo"] });
    expect(montarMudanca(cobrada, { ...NADA, papel: "eu cobro" })).toMatchObject({ corpo: {}, partes: [] });
    expect(montarMudanca(cobrada, { ...NADA, papel: "talvez" })).toEqual({ erro: "papel inválido: talvez" });
  });
});

describe("limite de pessoa na procura", () => {
  const nomes = ["Vitor Gambetti", "Tiago Moreira", "Paula Klotz", "Ana Tereza Souza", "Clara Dias", "Simone Rocha", "Welcome Weddings"];

  it("o assunto das reuniões não limita (o print do Vitor de 02/10/2026 e a revisão)", () => {
    for (const frase of [
      "Tem algumas reuniões que falei em fazer coisas no CRM, TTARS. Algumas inclusive devem estar repetidas. Consegue compilar e me mandar aqui, por favor?",
      "que falei em fazer",
      "Tudo que falamos sobre WhatsApp nas reuniões",
      "o que eu falei nas minhas reuniões sobre TTARS",
      "o que falei nas minhas últimas reuniões",
      "Devo ter falado de TTARS em várias reuniões, compila e me manda",
      "Compila pra mim tudo de TTARS",
      "Eu fiz umas reuniões sobre o CRM",
      "eu vou ver depois o que mesclar",
      "deixa a tela do funil mais clara",
      "Sim, manda todas",
      "o que falamos da Welcome Weddings nas reuniões",
      "Acho que devo ter falado de TTARS em várias reuniões",
      "Preciso fazer um resumo de tudo de TTARS",
      "Tenho que fazer uma apresentação com tudo de TTARS",
      "Preciso que você compile tudo de TTARS",
      "Preciso saber tudo de TTARS das reuniões",
      "manda o que tem pra mim ver",
    ]) {
      expect([frase, limitaPorPessoa(frase, nomes)]).toEqual([frase, false]);
    }
    expect(limitaPorPessoa(null, nomes)).toBe(false);
  });

  it("limita quando ela diz que é dela, de quem deve ou cita alguém", () => {
    for (const frase of [
      "O que eu fiquei de fazer no TTARS em todas as reuniões? Só as minhas",
      "Tem algo meu atrasado nos projetos do marketing?",
      "O que o marketing está esperando de mim?",
      "O que eu devo ao Tiago e o que ele me deve?",
      "Tem alguma ação com o meu nome nas reuniões dos outros que não está na minha lista?",
      "O que eu prometi nas reuniões com o Tiago?",
      "O que ele tem pendente comigo?",
      "O que a Paula está fazendo?",
      "todas as ações de TTARS que são minhas",
      "O que estou devendo pra ele?",
      "O que preciso fazer de TTARS em todas as reuniões?",
      "O que o marketing quer que eu faça?",
      "O que o Thiago me pediu?",
      "Quais ações de TTARS eu criei?",
      "o que eu tenho de fazer de TTARS",
      "o que falei de TTARS com a clara",
      "Só as minhas nas reuniões de TTARS",
      "só as minhas das reuniões",
      "O que ficou pra mim de TTARS nas reuniões?",
      "o que eu tenho que fazer de TTARS",
      "O que eu ainda tenho que fazer de TTARS nas reuniões?",
      "O que ainda preciso fazer no TTARS?",
      "Preciso fazer o quê no TTARS?",
      "O que eu preciso entregar de TTARS?",
      "Quais eu tenho que resolver no TTARS?",
    ]) {
      expect([frase, limitaPorPessoa(frase, nomes)]).toEqual([frase, true]);
    }
  });

  it("a citação tem de estar, nessa ordem, numa fala da pessoa", () => {
    const falas = ["O que eu devo pro Tiago?", "Me manda em texto"];
    expect(ditoPelaPessoa("eu devo pro Tiago", falas)).toBe(true);
    expect(ditoPelaPessoa("Tiago devo eu", falas)).toBe(false);
    expect(ditoPelaPessoa("só as minhas", falas)).toBe(false);
    expect(ditoPelaPessoa("", falas)).toBe(false);
    // "me" de "me mandar" e "devem" de "devem estar" não montam um "me devem"
    expect(ditoPelaPessoa("me devem", ["Algumas devem estar repetidas. Consegue me mandar aqui?"])).toBe(false);
  });

  it("sem limite de pessoa, a linha da escolha não diz quem faz nem de quem é a lista", () => {
    const l = linhaDoRetrato("t1", t({ owner: "Tiago", is_mine: false, compartilhada: true, criador_nome: "Paula Klotz" } as Partial<TarefaVista>));
    expect(linhaCorrida(l)).toContain("quem faz:");
    const sem = linhaCorrida(l, null, true);
    expect(sem).not.toContain("quem faz");
    expect(sem).not.toContain("lista de");
    expect(sem).toContain("Revisar orçamento");
    const ninguem = linhaDoRetrato("t2", t({ owner: "?", acao: "cobrar" }));
    expect(linhaCorrida(ninguem, null, true)).toContain("quem faz: a definir");
  });
});

describe("mudanças em lote só com o sim dela", () => {
  it("até 15 e até 3 de outras pessoas muda na hora", () => {
    expect(loteSemSim({ total: 15, deOutros: 3 }, null, "Joga para segunda tudo que está atrasado")).toBe(true);
  });

  it("140 na 1ª pergunta, ou em conversa antiga, espera o sim", () => {
    expect(loteSemSim({ total: 140, deOutros: 120 }, null, "Cancela as ações do marketing")).toBe(false);
    expect(loteSemSim({ total: 140, deOutros: 120 }, "Esta semana vencem 3 ações.", "Cancela as ações do marketing")).toBe(false);
  });

  it("o sim logo depois da pergunta com o número libera", () => {
    const pergunta = "Encontrei 116 ações de marketing, 9 suas. Confirma que quer cancelar todas as 116?";
    expect(loteSemSim({ total: 116, deOutros: 107 }, pergunta, "sim")).toBe(true);
    expect(loteSemSim({ total: 117, deOutros: 108 }, pergunta, "Sim, cancela todas")).toBe(true);
    // pergunta sem o número, ou resposta que não é sim
    expect(loteSemSim({ total: 116, deOutros: 107 }, "Quer cancelar todas?", "sim")).toBe(false);
    expect(loteSemSim({ total: 116, deOutros: 107 }, pergunta, "não, só as minhas")).toBe(false);
  });
});

import { describe, expect, it } from "bun:test";
import {
  ACENTOS,
  SEM_ACENTOS,
  anotarNaTela,
  casaComBusca,
  desfazerQuem,
  idsDasFalas,
  limparRefs,
  linhaDoRetrato,
  montarMudanca,
  padroesLike,
  palavrasDaBusca,
  precisaConfirmar,
  quandoVence,
  quemFazNaTela,
  semAcento,
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
    expect(limparRefs("Revisar o contrato [t3] até sexta")).toBe("Revisar o contrato até sexta");
    expect(limparRefs("Fale com a Paula (do marketing)")).toBe("Fale com a Paula (do marketing)");
  });
});

describe("busca por assunto", () => {
  it("palavras sem acento, sem repetir, no máximo 8", () => {
    expect(palavrasDaBusca(["CRM", "TTARS", "crm", " Régua  de convidados ", "x", 3])).toEqual(["crm", "ttars", "regua de convidados"]);
    expect(palavrasDaBusca("tars")).toEqual(["tars"]);
    expect(palavrasDaBusca(Array.from({ length: 12 }, (_, i) => `p${i}`))).toHaveLength(8);
  });
  it("acha no título ou na descrição, sem diferença de acento", () => {
    expect(casaComBusca({ titulo: "Ajustar a régua de convidados no Tars" }, ["regua"])).toBe(true);
    expect(casaComBusca({ titulo: "Revisar contrato", descricao: "levar para o CRM" }, ["crm"])).toBe(true);
    expect(casaComBusca({ titulo: "Revisar contrato", descricao: null }, ["crm", "ttars"])).toBe(false);
  });
  it("o banco tira os mesmos acentos e o LIKE não vira curinga", () => {
    expect(ACENTOS.length).toBe(SEM_ACENTOS.length);
    for (let i = 0; i < ACENTOS.length; i++) expect(semAcento(ACENTOS[i])).toBe(SEM_ACENTOS[i]);
    expect(padroesLike(["crm", "50%_off", "a\\b"])).toEqual(["%crm%", "%50\\%\\_off%", "%a\\\\b%"]);
  });
});

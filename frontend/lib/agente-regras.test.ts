import { describe, expect, it } from "bun:test";
import { desfazerQuem, linhaDoRetrato, montarMudanca, precisaConfirmar, quemFazNaTela, type TarefaVista } from "./agente-regras";

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

describe("precisaConfirmar", () => {
  it("tarefa de outra pessoa sempre pede Confirmar", () => {
    expect(precisaConfirmar(t({ compartilhada: true }), { prazo: "x" }, 0)).toBe(true);
  });
  it("minha muda na hora, menos um lote grande de conclusões", () => {
    expect(precisaConfirmar(t(), { status: "concluida" }, 3)).toBe(false);
    expect(precisaConfirmar(t(), { status: "concluida" }, 4)).toBe(true);
    expect(precisaConfirmar(t(), { prioridade: "alta" }, 9)).toBe(false);
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

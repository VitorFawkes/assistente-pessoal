import { describe, expect, it } from "bun:test";
import { acharColegaPorNome, ordenarPendencias, paraQuemVe, resolverDono, slugNome } from "./compartilhar";
import type { Tarefa } from "./queries";

const VITOR = { id: "u-vitor", nome: "Vitor Gambetti" };
const MARINA = { id: "u-marina", nome: "Marina Souza" };
const MARIA_A = { id: "u-maria-a", nome: "Maria Alves" };
const MARIA_B = { id: "u-maria-b", nome: "Maria Braga" };
const COLEGAS = [VITOR, MARINA, MARIA_A, MARIA_B];

function tarefa(over: Partial<Tarefa> = {}): Tarefa {
  return {
    id: "t1", user_id: VITOR.id, meeting_id: "m1", titulo: "Mandar contrato",
    descricao: null, owner: "eu", is_mine: true, acao: "executar",
    prazo: null, inicio: null, prazo_text: null, prioridade: "media",
    status: "aberta", evidencia: "eu mando o contrato", depende_de: null, frente: null,
    frente_proposta: null, frentes: [], pessoas: [], anexos: [],
    created_at: "2026-09-25T12:00:00Z", updated_at: "2026-09-25T12:00:00Z",
    concluida_em: null, cancelada_em: null, situacao_desde: null, precisa_revisao: false,
    ordem: null, no_plano: true, parece_com_id: null,
    meeting_summary: "Reunião com o fornecedor", meeting_nome: "Fornecedor",
    ...over,
  } as Tarefa;
}

describe("nome de colega", () => {
  it("acha pelo nome inteiro, sem acento nem maiúscula", () => {
    expect(acharColegaPorNome(COLEGAS, "marina souza")?.id).toBe(MARINA.id);
    expect(acharColegaPorNome([{ id: "x", nome: "João Araújo" }], "joao araujo")?.id).toBe("x");
  });
  it("acha pelo primeiro nome só quando é um só", () => {
    expect(acharColegaPorNome(COLEGAS, "Marina")?.id).toBe(MARINA.id);
    expect(acharColegaPorNome(COLEGAS, "Maria")).toBeNull();
  });
  it("não inventa: nome de fora não vira colega", () => {
    expect(acharColegaPorNome(COLEGAS, "Fornecedor X")).toBeNull();
    expect(acharColegaPorNome(COLEGAS, "")).toBeNull();
    expect(acharColegaPorNome(COLEGAS, "Marina Lima")).toBeNull();
  });
  it("slug igual ao do banco", () => {
    expect(slugNome("  Ação Ágil! ")).toBe("acao-agil");
  });
});

describe("trocar o dono", () => {
  const ctx = { donoId: VITOR.id, colegas: COLEGAS, slug: "eu" };

  it("escolher colega pela lista passa a tarefa pra ele", () => {
    expect(resolverDono({ responsavel_user_id: MARINA.id }, ctx)).toEqual({
      owner: "Marina Souza", acao: "cobrar", responsavel: MARINA.id,
    });
  });
  it("digitar o nome de um colega faz o mesmo", () => {
    expect(resolverDono({ owner: "Marina", acao: "cobrar" }, ctx)).toMatchObject({
      owner: "Marina Souza", responsavel: MARINA.id,
    });
  });
  it("escolher o próprio criador devolve a tarefa pra ele", () => {
    expect(resolverDono({ responsavel_user_id: VITOR.id }, ctx)).toEqual({
      owner: "eu", acao: "executar", responsavel: null,
    });
    expect(resolverDono({ owner: "Vitor Gambetti" }, ctx)).toMatchObject({ owner: "eu", responsavel: null });
  });
  it("slug ou vazio = do criador (é o 'sem dono' de quem não criou)", () => {
    expect(resolverDono({ owner: "eu" }, ctx)).toMatchObject({ owner: "eu", acao: "executar", responsavel: null });
    expect(resolverDono({ owner: "" }, ctx)).toMatchObject({ owner: "eu" });
  });
  it("nome de fora continua só nome e tira de quem estava", () => {
    expect(resolverDono({ owner: "Fornecedor X", acao: "aguardar" }, ctx)).toEqual({
      owner: "Fornecedor X", acao: "aguardar", responsavel: null,
    });
  });
  it("marcado como de fora na tela: fica só o nome, mesmo igual ao de um colega", () => {
    expect(resolverDono({ owner: "Marina", acao: "cobrar", de_fora: true }, ctx)).toEqual({
      owner: "Marina", acao: "cobrar", responsavel: null,
    });
    expect(resolverDono({ owner: "Marina Souza", acao: "aguardar", de_fora: true }, ctx)).toEqual({
      owner: "Marina Souza", acao: "aguardar", responsavel: null,
    });
  });
  it("recusa colega que não está no Ações", () => {
    expect(resolverDono({ responsavel_user_id: "u-estranho" }, ctx).erro).toBeTruthy();
  });
  it("só a ação 'executar' devolve pro criador; outras não mexem no dono", () => {
    expect(resolverDono({ acao: "executar" }, ctx)).toMatchObject({ owner: "eu", responsavel: null });
    expect(resolverDono({ acao: "aguardar" }, ctx)).toEqual({ acao: "aguardar" });
  });
  it("o criador nunca vira 'pessoa' da própria tarefa", () => {
    const r = resolverDono(
      { owner: "Vitor Gambetti", pessoas: [{ nome: "Vitor Gambetti", principal: true }, { nome: "Ana" }] },
      ctx,
    );
    expect(r.pessoas).toEqual([{ nome: "Ana" }]);
  });
  it("passar pra colega deixa ele como pessoa principal", () => {
    const r = resolverDono({ owner: "Marina", pessoas: [{ nome: "Ana", principal: true }] }, ctx);
    expect(r.pessoas).toEqual([{ nome: "Marina Souza", principal: true }, { nome: "Ana" }]);
  });
  it("sem pedido de dono não mexe em quem é o responsável", () => {
    expect(resolverDono({ pessoas: [{ nome: "Ana" }] }, ctx)).toEqual({ pessoas: [{ nome: "Ana" }] });
  });
});

describe("a tarefa vista por outra pessoa", () => {
  const nomes = new Map([[VITOR.id, VITOR.nome], [MARINA.id, MARINA.nome]]);

  it("quem criou vê igual", () => {
    const t = tarefa();
    expect(paraQuemVe(t, { viewerId: VITOR.id, slug: "eu", nomes })).toBe(t);
  });
  it("passada pra mim: vira minha, com o nome de quem mandou, sem a reunião", () => {
    const t = tarefa({
      owner: "Marina Souza", acao: "cobrar", is_mine: false, responsavel_user_id: MARINA.id,
      pessoas: [{ id: "p1", nome: "Marina Souza", principal: true }, { id: "p2", nome: "Ana", principal: false }],
      ...({ pessoas_raw: ["Marina", "Fornecedor X"] } as Partial<Tarefa>),
    });
    const v = paraQuemVe(t, { viewerId: MARINA.id, slug: "eu", nomes });
    expect(v).toMatchObject({ owner: "eu", acao: "executar", is_mine: true, compartilhada: true, criador_nome: "Vitor Gambetti" });
    expect(v.meeting_id).toBeNull();
    expect(v.evidencia).toBeNull();
    expect(v.meeting_summary).toBeNull();
    expect(v.meeting_nome).toBeNull();
    expect(v.no_plano).toBe(false);
    expect((v as unknown as Record<string, unknown>).pessoas_raw).toBeUndefined();
    // o próprio nome não aparece de novo como "pessoa da tarefa"
    expect(v.pessoas.map((p) => p.nome)).toEqual(["Ana"]);
  });
  it("no projeto, a tarefa que o criador faz aparece com o nome dele", () => {
    const v = paraQuemVe(tarefa(), { viewerId: MARINA.id, slug: "eu", nomes, donoNome: true });
    expect(v).toMatchObject({ owner: "Vitor Gambetti", acao: "cobrar", is_mine: false, dono_nome: "Vitor Gambetti" });
  });
  it("no projeto, cada um enxerga o nome certo do dono", () => {
    expect(paraQuemVe(tarefa(), { viewerId: VITOR.id, slug: "eu", nomes, donoNome: true }).dono_nome).toBe("Vitor Gambetti");
    const comPrincipal = tarefa({ owner: "Ana", acao: "cobrar", pessoas: [{ id: "p", nome: "Ana", principal: true }] });
    expect(paraQuemVe(comPrincipal, { viewerId: MARINA.id, slug: "eu", nomes, donoNome: true }).dono_nome).toBe("Ana");
  });
});

describe("ordem da lista", () => {
  it("abertas antes, prazo mais cedo antes, sem prazo depois", () => {
    const a = tarefa({ id: "a", prazo: "2026-10-02T00:00:00Z" });
    const b = tarefa({ id: "b", prazo: "2026-09-30T00:00:00Z" });
    const c = tarefa({ id: "c", prazo: null });
    const d = tarefa({ id: "d", status: "concluida", prazo: "2026-09-01T00:00:00Z" });
    expect([d, c, a, b].sort(ordenarPendencias).map((t) => t.id)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("quem também abre a reunião (filtro por reunião, 30/09/2026)", () => {
  const nomes = new Map([[VITOR.id, VITOR.nome], [MARINA.id, MARINA.nome]]);
  it("vê de qual reunião a ação saiu, sem o trecho dito nem o resumo", () => {
    const v = paraQuemVe(tarefa({ responsavel_user_id: MARINA.id, meeting_recorded_at: "2026-09-29T19:22:00Z", meeting_source: "teams" }), { viewerId: MARINA.id, slug: "eu", nomes, veReuniao: true });
    expect([v.meeting_id, v.meeting_nome, v.meeting_recorded_at, v.meeting_source, v.ve_reuniao]).toEqual(["m1", "Fornecedor", "2026-09-29T19:22:00Z", "teams", true]);
    expect([v.evidencia, v.meeting_summary]).toEqual([null, null]);
  });
  it("sem nome dado, o título vem do resumo (o resumo não vai)", () => {
    const v = paraQuemVe(tarefa({ responsavel_user_id: MARINA.id, meeting_nome: null, meeting_summary: "Alinhamento do evento da Paula\n\nDetalhes..." }), { viewerId: MARINA.id, slug: "eu", nomes, veReuniao: true });
    expect(v.meeting_nome).toBeTruthy();
    expect(v.meeting_nome).not.toBe("Reunião");
    expect(v.meeting_summary).toBeNull();
  });
  it("quem não abre a reunião continua sem saber qual é", () => {
    const v = paraQuemVe(tarefa({ responsavel_user_id: MARINA.id }), { viewerId: MARINA.id, slug: "eu", nomes });
    expect([v.meeting_id, v.meeting_nome, v.ve_reuniao, v.de_reuniao]).toEqual([null, null, undefined, true]);
  });
});

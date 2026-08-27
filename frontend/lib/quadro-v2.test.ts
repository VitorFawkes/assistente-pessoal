import { describe, expect, it } from "bun:test";
import {
  agrupar, colunasKanban, comparar, donoDe, faixaDoPrazo, passa,
  relacionadasDe, rotuloSituacao, FILTROS_VAZIOS, ORDEM_KANBAN,
} from "./quadro-v2";
import type { Tarefa } from "./queries";

// Instante explícito, não meia-noite local: com `new Date(2026,7,20)` o
// próprio teste mudava de resposta conforme o fuso da máquina.
const HOJE = "2026-08-20T15:00:00Z"; // qui 20/08/2026, 12h em Brasília

function tarefa(over: Partial<Tarefa> = {}): Tarefa {
  return {
    id: over.id ?? "t1", user_id: "u", meeting_id: null, titulo: "Tarefa",
    descricao: null, owner: "vitor", is_mine: true, acao: "executar",
    prazo: null, inicio: null, prazo_text: null, prioridade: "media",
    status: "aberta", evidencia: null, depende_de: null, frente: null,
    frente_proposta: null, frentes: [], pessoas: [], anexos: [],
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    concluida_em: null, cancelada_em: null, precisa_revisao: false,
    ordem: null, no_plano: false, ...over,
  } as Tarefa;
}

const pessoa = (nome: string, principal = false) => ({ id: nome, nome, principal });

describe("as 4 situações", () => {
  it("tem os rótulos que o Vitor pediu", () => {
    expect(ORDEM_KANBAN).toEqual(["aberta", "em_andamento", "aguardando_aprovacao", "concluida"]);
    expect(rotuloSituacao("aberta")).toBe("A fazer");
    expect(rotuloSituacao("em_andamento")).toBe("Fazendo");
    expect(rotuloSituacao("aguardando_aprovacao")).toBe("Aguardando aprovação");
    expect(rotuloSituacao("concluida")).toBe("Feito");
  });

  it("no Kanban toda coluna aparece, mesmo vazia", () => {
    const cols = colunasKanban([tarefa({ status: "aberta" })]);
    expect(cols.map((c) => c.chave)).toEqual(ORDEM_KANBAN);
    expect(cols[0].tarefas).toHaveLength(1);
    expect(cols[3].tarefas).toHaveLength(0);
  });
});

describe("dono e pessoas relacionadas", () => {
  it("dono é quem está marcado como principal", () => {
    const t = tarefa({ pessoas: [pessoa("Robson", true), pessoa("Giordana")] });
    expect(donoDe(t)).toBe("Robson");
    expect(relacionadasDe(t)).toEqual(["Giordana"]);
  });

  it("tarefa sem ninguém fica sem dono", () => {
    expect(donoDe(tarefa())).toBeNull();
  });
});

describe("faixas de prazo", () => {
  it("separa atrasada, hoje, semana, depois e sem prazo", () => {
    expect(faixaDoPrazo(tarefa({ prazo: "2026-08-14T12:00:00Z" }), HOJE)).toBe("vencida");
    expect(faixaDoPrazo(tarefa({ prazo: "2026-08-20T12:00:00Z" }), HOJE)).toBe("hoje");
    expect(faixaDoPrazo(tarefa({ prazo: "2026-08-24T12:00:00Z" }), HOJE)).toBe("semana");
    expect(faixaDoPrazo(tarefa({ prazo: "2026-09-30T12:00:00Z" }), HOJE)).toBe("depois");
    expect(faixaDoPrazo(tarefa(), HOJE)).toBe("semprazo");
  });

  it("concluída não é atrasada, mesmo com prazo vencido", () => {
    expect(faixaDoPrazo(tarefa({ prazo: "2026-08-01T12:00:00Z", status: "concluida" }), HOJE)).toBe("feito");
  });
});

describe("filtros", () => {
  const lista = [
    tarefa({ id: "a", titulo: "Google Ads", frente: "Mídia", pessoas: [pessoa("Giordana", true)], prazo: "2026-08-14T12:00:00Z" }),
    tarefa({ id: "b", titulo: "TikTok", pessoas: [pessoa("Robson", true), pessoa("Giordana")], status: "em_andamento" }),
    tarefa({ id: "c", titulo: "Sem ninguém", status: "concluida" }),
  ];
  const filtra = (f: Partial<typeof FILTROS_VAZIOS>) =>
    lista.filter((t) => passa(t, { ...FILTROS_VAZIOS, ...f }, HOJE)).map((t) => t.id);

  it("por pessoa pega dono E relacionada", () => {
    expect(filtra({ pessoa: "Giordana" })).toEqual(["a", "b"]);
    expect(filtra({ pessoa: "__sem__" })).toEqual(["c"]);
  });

  it("por situação, tema, prazo e busca", () => {
    expect(filtra({ situacao: "em_andamento" })).toEqual(["b"]);
    expect(filtra({ tema: "Mídia" })).toEqual(["a"]);
    expect(filtra({ prazo: "vencida" })).toEqual(["a"]);
    expect(filtra({ busca: "tiktok" })).toEqual(["b"]);
  });

  it("esconder concluídas tira só as concluídas", () => {
    expect(filtra({ concluidas: false })).toEqual(["a", "b"]);
  });
});

describe("ordenação", () => {
  const antiga = tarefa({ id: "antiga", prazo: "2026-08-14T12:00:00Z" });
  const nova = tarefa({ id: "nova", prazo: "2026-09-01T12:00:00Z" });
  const sem = tarefa({ id: "sem" });

  it("por data, da mais antiga pra mais nova, e sem prazo no fim", () => {
    const r = [sem, nova, antiga].sort((a, b) => comparar(a, b, "prazo")).map((t) => t.id);
    expect(r).toEqual(["antiga", "nova", "sem"]);
  });

  it("da mais nova pra mais antiga também deixa sem prazo no fim", () => {
    const r = [sem, antiga, nova].sort((a, b) => comparar(a, b, "prazo_desc")).map((t) => t.id);
    expect(r).toEqual(["nova", "antiga", "sem"]);
  });

  it("por título de A a Z", () => {
    const r = [tarefa({ id: "z", titulo: "Zebra" }), tarefa({ id: "a", titulo: "Abacaxi" })]
      .sort((x, y) => comparar(x, y, "titulo")).map((t) => t.id);
    expect(r).toEqual(["a", "z"]);
  });
});

describe("agrupamento (Ver por)", () => {
  const lista = [
    tarefa({ id: "a", pessoas: [pessoa("Giordana", true)], frente: "Mídia" }),
    tarefa({ id: "b", status: "concluida" }),
  ];

  it("sem agrupar, tudo num bloco só", () => {
    const g = agrupar(lista, "nada");
    expect(g).toHaveLength(1);
    expect(g[0].tarefas).toHaveLength(2);
  });

  it("ninguém some: sem dono e sem tema viram grupo próprio", () => {
    expect(agrupar(lista, "pessoa").map((g) => g.rotulo)).toContain("Sem dono");
    expect(agrupar(lista, "tema").map((g) => g.rotulo)).toContain("Sem tema");
  });

  it("por situação sai na ordem do Kanban", () => {
    const g = agrupar([tarefa({ status: "concluida" }), tarefa({ status: "aberta" })], "situacao");
    expect(g.map((x) => x.chave)).toEqual(["aberta", "concluida"]);
  });

  it("nenhuma tarefa se perde em nenhum agrupamento", () => {
    for (const modo of ["nada", "situacao", "pessoa", "prazo", "tema"] as const) {
      const total = agrupar(lista, modo).reduce((n, g) => n + g.tarefas.length, 0);
      expect(total).toBe(lista.length);
    }
  });
});

import { describe, expect, test } from "bun:test";
import {
  compararComExistentes,
  cosseno,
  decidir,
  embaralhar,
  lerVotos,
  montarMensagens,
  textoParaVetor,
  type Candidata,
  type Juiz,
  type Voto,
} from "./tarefas-repetidas";

const cand = (id: string, status = "aberta"): Candidata => ({
  id,
  titulo: `tarefa ${id}`,
  descricao: null,
  owner: "vitor",
  status,
  criada_em: "2026-07-01T12:00:00Z",
  reuniao_em: "2026-07-01T12:00:00Z",
  concluida_em: status === "concluida" ? "2026-07-10T12:00:00Z" : null,
});

const votos = (...vs: [number, Voto][]) => new Map<number, Voto>(vs);
const mesma = (c: string): Voto => ({ decisao: "mesma", candidata: c });
const nova: Voto = { decisao: "nova", candidata: null };

describe("decidir — a regra dos 3 votos", () => {
  const porRotulo = new Map([
    ["C1", cand("a")],
    ["C2", cand("b")],
    ["C3", cand("c", "concluida")],
  ]);
  const rotulos = [["C1", "C2", "C3"]];

  test("3 de 3 na mesma candidata aberta → junta", () => {
    const d = decidir(1, [votos([0, mesma("C1")]), votos([0, mesma("C1")]), votos([0, mesma("C1")])], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "mesma", tarefaId: "a", votos: 3 });
  });

  test("2 de 3 → dúvida (nasce com o aviso)", () => {
    const d = decidir(1, [votos([0, mesma("C1")]), votos([0, mesma("C1")]), votos([0, nova])], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "duvida", tarefaId: "a", votos: 2 });
  });

  test("1 de 3 → nasce normal, sem aviso", () => {
    const d = decidir(1, [votos([0, nova]), votos([0, mesma("C2")]), votos([0, nova])], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "nova", votos: 0 });
  });

  test("0 de 3 → nova", () => {
    const d = decidir(1, [votos([0, nova]), votos([0, nova]), votos([0, nova])], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "nova", votos: 0 });
  });

  test("3 votos divididos entre candidatas diferentes → dúvida, nunca junta", () => {
    const d = decidir(1, [votos([0, mesma("C1")]), votos([0, mesma("C2")]), votos([0, mesma("C1")])], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "duvida", tarefaId: "a", votos: 3 });
  });

  test("candidata concluída nunca junta sozinha, mesmo com 3 de 3", () => {
    const d = decidir(1, [votos([0, mesma("C3")]), votos([0, mesma("C3")]), votos([0, mesma("C3")])], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "duvida", tarefaId: "c", votos: 3 });
  });

  test("uma execução falhou → no máximo dúvida", () => {
    const d = decidir(1, [votos([0, mesma("C1")]), votos([0, mesma("C1")]), null], rotulos, porRotulo);
    expect(d[0].tipo).toBe("duvida");
  });

  test("as 3 falharam → nova (a tarefa nunca se perde)", () => {
    const d = decidir(1, [null, null, null], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "nova", votos: 0 });
  });

  test("rótulo que não foi mostrado pra essa tarefa não conta", () => {
    const d = decidir(1, [votos([0, mesma("C9")]), votos([0, mesma("C9")]), votos([0, mesma("C9")])], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "nova", votos: 0 });
  });

  test("\"talvez\" nunca junta: 2 mesma + 1 talvez → dúvida", () => {
    const talvez: Voto = { decisao: "talvez", candidata: "C1" };
    const d = decidir(1, [votos([0, mesma("C1")]), votos([0, mesma("C1")]), votos([0, talvez])], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "duvida", tarefaId: "a", votos: 3 });
  });

  test("2 \"talvez\" → dúvida; 1 só → nova", () => {
    const talvez: Voto = { decisao: "talvez", candidata: "C2" };
    const dois = decidir(1, [votos([0, talvez]), votos([0, talvez]), votos([0, nova])], rotulos, porRotulo);
    expect(dois[0]).toEqual({ tipo: "duvida", tarefaId: "b", votos: 2 });
    const um = decidir(1, [votos([0, talvez]), votos([0, nova]), votos([0, nova])], rotulos, porRotulo);
    expect(um[0]).toEqual({ tipo: "nova", votos: 0 });
  });

  test("empate vai pra candidata mais parecida (a primeira da lista)", () => {
    const d = decidir(1, [votos([0, mesma("C2")]), votos([0, mesma("C1")]), votos([0, nova])], rotulos, porRotulo);
    expect(d[0]).toEqual({ tipo: "duvida", tarefaId: "a", votos: 2 });
  });
});

describe("lerVotos", () => {
  const d = (nova: number, candidata: string | null, a: boolean, b: boolean, talvez = false) => ({
    nova,
    candidata,
    existente_resolve_nova: a,
    nova_resolve_existente: b,
    talvez,
    motivo: "x",
  });

  test("talvez com candidata vira voto de dúvida; sem candidata, nova", () => {
    const v = lerVotos(JSON.stringify({ decisoes: [d(1, "C1", true, false, true), d(2, null, false, false, true)] }));
    expect(v.get(0)).toEqual({ decisao: "talvez", candidata: "C1" });
    expect(v.get(1)).toEqual({ decisao: "nova", candidata: null });
  });

  test("só é mesma com as duas respostas sim (1-based → índice)", () => {
    const v = lerVotos(
      JSON.stringify({
        decisoes: [d(1, "c2", true, true), d(2, "C1", true, false), d(3, "C1", false, true), d(4, null, true, true)],
      }),
    );
    expect(v.get(0)).toEqual({ decisao: "mesma", candidata: "C2" });
    expect(v.get(1)).toEqual({ decisao: "nova", candidata: null });
    expect(v.get(2)).toEqual({ decisao: "nova", candidata: null });
    expect(v.get(3)).toEqual({ decisao: "nova", candidata: null });
  });

  test("resposta repetida pra mesma tarefa: vale a primeira", () => {
    const v = lerVotos(JSON.stringify({ decisoes: [d(1, null, false, false), d(1, "C1", true, true)] }));
    expect(v.get(0)).toEqual({ decisao: "nova", candidata: null });
  });
});

describe("embaralhar", () => {
  test("mesma semente, mesma ordem; outra semente, outra ordem; nada some", () => {
    const l = Array.from({ length: 10 }, (_, i) => i);
    expect(embaralhar(l, 1)).toEqual(embaralhar(l, 1));
    expect(embaralhar(l, 1)).not.toEqual(embaralhar(l, 2));
    expect([...embaralhar(l, 3)].sort((a, b) => a - b)).toEqual(l);
  });
});

describe("montarMensagens", () => {
  test("mostra data da reunião, status, exemplos da pessoa e pula tarefa sem candidata", () => {
    const [sys, user] = montarMensagens(
      "2026-08-12T18:00:00Z",
      [
        { nova: { titulo: "Nova A", owner: "Fer" }, candidatas: [{ rotulo: "C1", c: cand("a", "concluida") }] },
        { nova: { titulo: "Nova B" }, candidatas: [] },
      ],
      [{ tipo: "diferente", nova: "X", existente: "Y" }],
      1,
    );
    expect(user.content).toContain("Reunião de 12/08/2026.");
    expect(user.content).toContain("TAREFA NOVA 1: Nova A");
    expect(user.content).toContain("CONCLUÍDA em 10/07/2026");
    expect(user.content).not.toContain("TAREFA NOVA 2");
    expect(sys.content).toContain('"X" e "Y" → diferentes (não)');
  });
});

describe("compararComExistentes", () => {
  const candidatas = [cand("a"), cand("b")];
  const vetoresCandidatas = new Map([
    ["a", [1, 0]],
    ["b", [0, 1]],
  ]);

  test("junta com 3 de 3 e mostra as candidatas da mais parecida pra menos", async () => {
    const juiz: Juiz = async () => ({ votos: votos([0, mesma("C1")]), entrada: 10, saida: 2 });
    const r = await compararComExistentes({
      dataReuniao: "2026-07-05T12:00:00Z",
      novas: [{ titulo: "x" }],
      vetoresNovas: [[0.9, 0.1]],
      candidatas,
      vetoresCandidatas,
      juiz,
    });
    expect(r.decisoes[0]).toEqual({ tipo: "mesma", tarefaId: "a", votos: 3 });
    expect(r.mostradas[0].map((m) => m.id)).toEqual(["a", "b"]);
    expect(r.uso).toEqual({ entrada: 30, saida: 6, chamadas: 3, falhas: 0 });
  });

  test("juiz fora do ar → tudo nasce como nova", async () => {
    const juiz: Juiz = async () => {
      throw new Error("429");
    };
    const r = await compararComExistentes({
      dataReuniao: null,
      novas: [{ titulo: "x" }],
      vetoresNovas: [[1, 0]],
      candidatas,
      vetoresCandidatas,
      juiz,
    });
    expect(r.decisoes[0].tipo).toBe("nova");
    expect(r.uso.falhas).toBe(3);
  });

  test("3 de 3 em card de mais de 3 semanas → aviso, não junta", async () => {
    const velho = { ...cand("a"), reuniao_em: "2026-07-01T12:00:00Z" };
    const juiz: Juiz = async () => ({ votos: votos([0, mesma("C1")]), entrada: 1, saida: 1 });
    const base = { novas: [{ titulo: "x" }], vetoresNovas: [[1, 0]], candidatas: [velho], vetoresCandidatas: new Map([["a", [1, 0]]]), juiz };
    const r22 = await compararComExistentes({ ...base, dataReuniao: "2026-07-23T12:00:00Z" });
    expect(r22.decisoes[0]).toEqual({ tipo: "duvida", tarefaId: "a", votos: 3 });
    const r20 = await compararComExistentes({ ...base, dataReuniao: "2026-07-21T12:00:00Z" });
    expect(r20.decisoes[0]).toEqual({ tipo: "mesma", tarefaId: "a", votos: 3 });
  });

  test("sem candidatas nem chama o juiz", async () => {
    let chamou = false;
    const juiz: Juiz = async () => {
      chamou = true;
      return { votos: new Map(), entrada: 0, saida: 0 };
    };
    const r = await compararComExistentes({
      dataReuniao: null,
      novas: [{ titulo: "x" }],
      vetoresNovas: [[1, 0]],
      candidatas: [],
      vetoresCandidatas: new Map(),
      juiz,
    });
    expect(chamou).toBe(false);
    expect(r.decisoes[0].tipo).toBe("nova");
  });
});

test("cosseno e texto do vetor", () => {
  expect(cosseno([1, 0], [1, 0])).toBeCloseTo(1);
  expect(cosseno([1, 0], [0, 1])).toBeCloseTo(0);
  expect(textoParaVetor({ titulo: " A ", descricao: " b " })).toBe("A\nb");
  expect(textoParaVetor({ titulo: "A", descricao: null })).toBe("A");
});

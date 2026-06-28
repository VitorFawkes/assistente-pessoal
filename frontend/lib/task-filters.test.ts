import { test, expect, describe } from "bun:test";
import {
  matchesSearch,
  areaOf,
  tipoOf,
  principalPersonOf,
  personNamesOf,
  inMeetingDate,
  dateInRange,
  sortTarefas,
  applyFacets,
  countBy,
  activeFacetCount,
  type Facets,
} from "./task-filters";
import type { Tarefa } from "@/components/task-row";

// Quarta, 2026-06-24 10:00 local.
const NOW = new Date(2026, 5, 24, 10, 0, 0, 0);

function mk(p: Partial<Tarefa>): Tarefa {
  return {
    id: Math.random().toString(36).slice(2),
    meeting_id: "m1",
    titulo: "tarefa",
    descricao: null,
    owner: "vitor",
    is_mine: true,
    acao: "executar",
    prazo: null,
    inicio: null,
    prazo_text: null,
    prioridade: "media",
    status: "aberta",
    evidencia: null,
    frente: null,
    frente_proposta: null,
    pessoas: [],
    created_at: "2026-06-20T10:00:00Z",
    precisa_revisao: false,
    ordem: null,
    no_plano: false,
    meeting_recorded_at: null,
    meeting_summary: null,
    meeting_type: null,
    ...p,
  } as Tarefa;
}

function emptyFacets(over: Partial<Facets> = {}): Facets {
  return {
    pessoas: new Set(),
    areas: new Set(),
    meetingDate: "qualquer",
    prioridades: new Set(),
    tipos: new Set(),
    ...over,
  };
}

describe("matchesSearch", () => {
  const t = mk({
    titulo: "Ligar pro fornecedor",
    descricao: "sobre o contrato",
    pessoas: [{ id: "1", nome: "Diana", principal: true }],
    frente: "Weddings",
  });
  test("vazio casa tudo", () => expect(matchesSearch(t, "  ")).toBe(true));
  test("casa no título", () => expect(matchesSearch(t, "ligar")).toBe(true));
  test("casa na pessoa", () => expect(matchesSearch(t, "diana")).toBe(true));
  test("casa na área", () => expect(matchesSearch(t, "weddings")).toBe(true));
  test("AND entre tokens", () => {
    expect(matchesSearch(t, "ligar contrato")).toBe(true);
    expect(matchesSearch(t, "ligar inexistente")).toBe(false);
  });
});

describe("derivações", () => {
  test("areaOf cai pra proposta e depois Sem área", () => {
    expect(areaOf(mk({ frente: "Vendas" }))).toBe("Vendas");
    expect(areaOf(mk({ frente: null, frente_proposta: "Produto" }))).toBe("Produto");
    expect(areaOf(mk({}))).toBe("Sem área");
  });
  test("tipoOf: manual vs modalidade", () => {
    expect(tipoOf(mk({ meeting_id: null }))).toBe("Manual");
    expect(tipoOf(mk({ meeting_type: "online" }))).toBe("online");
    expect(tipoOf(mk({ meeting_type: null }))).toBe("desconhecido");
  });
  test("principalPersonOf", () => {
    expect(principalPersonOf(mk({ acao: "executar" }))).toBe("Você");
    expect(
      principalPersonOf(
        mk({ acao: "cobrar", pessoas: [{ id: "1", nome: "Tiago", principal: true }] }),
      ),
    ).toBe("Tiago");
    expect(principalPersonOf(mk({ acao: "cobrar", owner: "Ana", pessoas: [] }))).toBe("Ana");
  });
  test("personNamesOf lista nomes", () => {
    expect(
      personNamesOf(
        mk({ pessoas: [{ id: "1", nome: "Diana", principal: true }, { id: "2", nome: "Tiago", principal: false }] }),
      ),
    ).toEqual(["Diana", "Tiago"]);
  });
});

describe("inMeetingDate (cumulativo)", () => {
  const hoje = mk({ meeting_recorded_at: "2026-06-24T09:00:00Z" });
  const ontem = mk({ meeting_recorded_at: "2026-06-23T09:00:00Z" });
  const mesPassado = mk({ meeting_recorded_at: "2026-05-10T09:00:00Z" });
  test("qualquer sempre true", () => expect(inMeetingDate(ontem, "qualquer", NOW)).toBe(true));
  test("hoje", () => {
    expect(inMeetingDate(hoje, "hoje", NOW)).toBe(true);
    expect(inMeetingDate(ontem, "hoje", NOW)).toBe(false);
  });
  test("semana inclui hoje e ontem (mesma semana)", () => {
    expect(inMeetingDate(hoje, "semana", NOW)).toBe(true);
    expect(inMeetingDate(ontem, "semana", NOW)).toBe(true);
  });
  test("mes vs antigas", () => {
    expect(inMeetingDate(ontem, "mes", NOW)).toBe(true);
    expect(inMeetingDate(mesPassado, "mes", NOW)).toBe(false);
    expect(inMeetingDate(mesPassado, "antigas", NOW)).toBe(true);
  });
  test("sem reunião nunca casa bucket específico", () => {
    expect(inMeetingDate(mk({ meeting_recorded_at: null }), "hoje", NOW)).toBe(false);
  });
});

describe("dateInRange", () => {
  const iso = "2026-06-15T09:00:00Z"; // 15/06 (SP)
  test("sem from/to casa tudo", () => expect(dateInRange(iso)).toBe(true));
  test("dentro do intervalo", () => {
    expect(dateInRange(iso, "2026-06-01", "2026-06-30")).toBe(true);
  });
  test("antes do from", () => {
    expect(dateInRange(iso, "2026-06-20", undefined)).toBe(false);
  });
  test("depois do to", () => {
    expect(dateInRange(iso, undefined, "2026-06-10")).toBe(false);
  });
  test("limites inclusivos", () => {
    expect(dateInRange(iso, "2026-06-15", "2026-06-15")).toBe(true);
  });
  test("sem data nunca casa intervalo", () => {
    expect(dateInRange(null, "2026-06-01", undefined)).toBe(false);
  });
});

describe("applyFacets — intervalo de data da reunião tem precedência sobre bucket", () => {
  const list = [
    mk({ meeting_recorded_at: "2026-06-15T09:00:00Z" }),
    mk({ meeting_recorded_at: "2026-05-01T09:00:00Z" }),
    mk({ meeting_recorded_at: null }),
  ];
  test("range filtra por data", () => {
    const f: Facets = {
      pessoas: new Set(),
      areas: new Set(),
      meetingDate: "qualquer",
      meetingFrom: "2026-06-01",
      meetingTo: "2026-06-30",
      prioridades: new Set(),
      tipos: new Set(),
    };
    expect(applyFacets(list, f, undefined, NOW).length).toBe(1);
  });
});

describe("applyFacets (AND entre facetas, exclude p/ contagem)", () => {
  const list = [
    mk({ pessoas: [{ id: "1", nome: "Diana", principal: true }], frente: "Weddings", prioridade: "urgente" }),
    mk({ pessoas: [{ id: "2", nome: "Tiago", principal: true }], frente: "Weddings", prioridade: "media" }),
    mk({ pessoas: [{ id: "1", nome: "Diana", principal: true }], frente: "Vendas", prioridade: "alta" }),
  ];
  test("pessoa + área combinam (AND)", () => {
    const f = emptyFacets({ pessoas: new Set(["Diana"]), areas: new Set(["Weddings"]) });
    expect(applyFacets(list, f, undefined, NOW).length).toBe(1);
  });
  test("exclude ignora a própria faceta (pra contagem)", () => {
    const f = emptyFacets({ pessoas: new Set(["Diana"]), areas: new Set(["Weddings"]) });
    // excluindo 'areas': só filtra por pessoa Diana → 2
    expect(applyFacets(list, f, "areas", NOW).length).toBe(2);
  });
  test("prioridade", () => {
    const f = emptyFacets({ prioridades: new Set(["urgente", "alta"]) });
    expect(applyFacets(list, f, undefined, NOW).length).toBe(2);
  });
});

describe("sortTarefas", () => {
  const a = mk({ titulo: "A", created_at: "2026-06-01T10:00:00Z", prazo: "2026-06-20T00:00:00Z", prioridade: "baixa", meeting_recorded_at: "2026-05-01T10:00:00Z" });
  const b = mk({ titulo: "B", created_at: "2026-06-10T10:00:00Z", prazo: "2026-06-05T00:00:00Z", prioridade: "urgente", meeting_recorded_at: "2026-06-09T10:00:00Z" });
  const c = mk({ titulo: "C", created_at: "2026-06-05T10:00:00Z", prazo: null, prioridade: "media", meeting_recorded_at: null });
  const list = [a, b, c];
  const titles = (l: ReturnType<typeof sortTarefas>) => l.map((t) => t.titulo);

  test("criacao_desc: mais nova primeiro", () => {
    expect(titles(sortTarefas(list, "criacao_desc"))).toEqual(["B", "C", "A"]);
  });
  test("criacao_asc: mais antiga primeiro", () => {
    expect(titles(sortTarefas(list, "criacao_asc"))).toEqual(["A", "C", "B"]);
  });
  test("prazo: deadline mais cedo primeiro, sem prazo por último", () => {
    expect(titles(sortTarefas(list, "prazo"))).toEqual(["B", "A", "C"]);
  });
  test("prioridade: urgente primeiro", () => {
    expect(titles(sortTarefas(list, "prioridade"))[0]).toBe("B");
  });
  test("reuniao_desc: reunião mais nova primeiro, sem reunião por último", () => {
    expect(titles(sortTarefas(list, "reuniao_desc"))).toEqual(["B", "A", "C"]);
  });
  test("não muta o original", () => {
    const orig = [...list];
    sortTarefas(list, "criacao_desc");
    expect(list).toEqual(orig);
  });
  test("tolera created_at/prazo como Date (vem do pg via RSC), não só string", () => {
    const x = mk({ titulo: "X", created_at: new Date("2026-06-30T10:00:00Z") as unknown as string });
    const y = mk({ titulo: "Y", created_at: new Date("2026-06-01T10:00:00Z") as unknown as string });
    expect(titles(sortTarefas([y, x], "criacao_desc"))).toEqual(["X", "Y"]);
    expect(titles(sortTarefas([x, y], "criacao_asc"))).toEqual(["Y", "X"]);
  });
});

describe("countBy + activeFacetCount", () => {
  const list = [
    mk({ pessoas: [{ id: "1", nome: "Diana", principal: true }] }),
    mk({ pessoas: [{ id: "1", nome: "Diana", principal: true }, { id: "2", nome: "Tiago", principal: false }] }),
  ];
  test("countBy conta múltiplas chaves por item", () => {
    const c = countBy(list, personNamesOf);
    expect(c.get("Diana")).toBe(2);
    expect(c.get("Tiago")).toBe(1);
  });
  test("activeFacetCount soma seleções", () => {
    expect(activeFacetCount(emptyFacets())).toBe(0);
    expect(
      activeFacetCount(emptyFacets({ pessoas: new Set(["Diana"]), meetingDate: "semana" })),
    ).toBe(2);
  });
});

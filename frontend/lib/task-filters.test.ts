import { test, expect, describe } from "bun:test";
import {
  matchesSearch,
  areaOf,
  tipoOf,
  principalPersonOf,
  personNamesOf,
  inMeetingDate,
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

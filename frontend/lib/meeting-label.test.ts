import { describe, expect, test } from "bun:test";
import { meetingDateShort, meetingLabel, meetingSubject } from "./meeting-label";

// Resumos reais de produção — todos abrem com a mesma fórmula, que é
// exatamente o que tornava a lista/o filtro ilegível.
const REAIS: [string, string][] = [
  [
    "Reunião entre Vitor e um especialista de growth/mídia para diagnosticar o outbound/máquina de aquisição da Welcome (Trips/Weddings), revisar tracking, CRM e funil (MQL/SQL/SAL) e preparar um encontro mais estratégico com o Thiago.",
    "Diagnosticar o outbound",
  ],
  [
    "Reunião interna focada em marketing, qualificação de leads e alinhamento comercial da operação de Destination Wedding.",
    "Marketing, qualificação",
  ],
  [
    "Reunião operacional focada na migração e ajustes de processos entre Active, TARS, Monde e WhatsApp.",
    "Migração e ajustes",
  ],
  [
    "Conversa 1:1 entre Vitor e uma pessoa do time de dados/weddings, focada em como ela está no modelo atual de trabalho.",
    "Como ela está",
  ],
  [
    "Reunião operacional entre Vitor e Ana sobre migração de casamentos para nova plataforma.",
    "Migração de casamentos",
  ],
];

describe("meetingSubject", () => {
  test("tira a abertura genérica e sobra o assunto", () => {
    for (const [resumo, comeco] of REAIS) {
      expect(meetingSubject(resumo)).toStartWith(comeco);
    }
  });

  test("nunca começa com 'Reunião'/'Conversa' quando há assunto", () => {
    for (const [resumo] of REAIS) {
      expect(meetingSubject(resumo)).not.toMatch(/^(Reuni|Conversa)/i);
    }
  });

  test("resumo que já começa pelo assunto fica intacto", () => {
    const s = "Ajustes de parametrização de UTMs no Google e no Meta";
    expect(meetingSubject(s)).toBe(s);
  });

  test("corta na primeira frase, não no meio de uma enumeração", () => {
    const s =
      "Reunião interna focada em marketing, vendas e produto. Segunda frase que não interessa.";
    expect(meetingSubject(s)).toBe("Marketing, vendas e produto");
  });

  test("vazio/nulo não quebra", () => {
    expect(meetingSubject(null)).toBe("");
    expect(meetingSubject("")).toBe("");
    expect(meetingSubject(undefined)).toBe("");
  });

  test("nunca devolve string vazia quando havia texto", () => {
    for (const s of ["Reunião", "Conversa curta", "Call", "Reunião de time"]) {
      expect(meetingSubject(s).length).toBeGreaterThan(0);
    }
  });

  test("reuniões que ficavam idênticas no espaço do filtro passam a se distinguir", () => {
    // Antes: as duas cortam em "Reunião interna focada em perfor…".
    const a =
      "Reunião interna focada em performance de leads e campanhas no Google e no Meta.";
    const b =
      "Reunião interna focada em performance do time comercial e metas do trimestre.";
    const corte = (s: string) => s.slice(0, 34);
    expect(corte(a)).toBe(corte(b));
    expect(corte(meetingSubject(a))).not.toBe(corte(meetingSubject(b)));
  });
});

describe("meetingLabel", () => {
  test("junta data e assunto", () => {
    const l = meetingLabel(REAIS[0][0], "2026-08-10T12:54:00Z");
    expect(l).toStartWith("10/ago · ");
    expect(l).toContain("Diagnosticar o outbound");
  });

  test("sem data cadastrada, só o assunto", () => {
    expect(meetingLabel(REAIS[0][0], null)).toStartWith("Diagnosticar");
  });

  test("data inválida não vira 'Invalid Date'", () => {
    expect(meetingDateShort("nao-e-data")).toBe("");
    expect(meetingLabel("Reunião de time sobre o funil", "nao-e-data")).not.toContain("Invalid");
  });

  test("sem resumo nenhum ainda dá um rótulo usável", () => {
    expect(meetingLabel(null, "2026-08-10T12:54:00Z")).toBe("10/ago · Reunião");
  });
});

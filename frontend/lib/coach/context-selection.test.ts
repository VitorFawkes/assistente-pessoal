import { describe, expect, test } from "bun:test";
import { contextSearchTerms, resolveContextPeriod } from "./context-selection";

describe("coach requested period", () => {
  test("today is the user's local day, not the server's UTC date", () => {
    expect(resolveContextPeriod("Como foi meu dia hoje?", {now:new Date("2026-09-21T01:30:00Z"), timezone:"America/Sao_Paulo"}))
      .toEqual({kind:"today", label:"hoje (2026-09-20)", from:"2026-09-20T03:00:00.000Z", to:"2026-09-21T03:00:00.000Z", timezone:"America/Sao_Paulo"});
  });
  test("yesterday and this week use calendar boundaries, including DST", () => {
    expect(resolveContextPeriod("Quero revisar ontem", {now:new Date("2026-03-09T12:00:00Z"), timezone:"America/New_York"}))
      .toMatchObject({kind:"yesterday", from:"2026-03-08T05:00:00.000Z", to:"2026-03-09T04:00:00.000Z"});
    expect(resolveContextPeriod("O que avancei nesta semana?", {now:new Date("2026-09-20T18:00:00Z"), timezone:"America/Sao_Paulo"}))
      .toMatchObject({kind:"week", from:"2026-09-14T03:00:00.000Z", to:"2026-09-21T03:00:00.000Z"});
  });
  test("does not invent a period for general coaching or ignore an explicit review window", () => {
    expect(resolveContextPeriod("Como priorizar meus projetos?")).toBeNull();
    expect(resolveContextPeriod("hoje", {timezone:"America/Sao_Paulo", period:{from:"2026-09-11T20:00:00Z",to:"2026-09-18T20:00:00Z",label:"revisão semanal"}}))
      .toMatchObject({kind:"explicit",label:"revisão semanal",from:"2026-09-11T20:00:00.000Z",to:"2026-09-18T20:00:00.000Z"});
    expect(() => resolveContextPeriod("hoje", {period:{from:"invalid",to:"2026-09-18"}})).toThrow();
  });
  test("generic coaching language does not bury the project being requested", () => {
    expect(contextSearchTerms("Como você pode me ajudar hoje sobre orquídea?")).toBe("orquídea");
    expect(contextSearchTerms("Como posso revisar meu dia hoje?")).toBe("");
  });
});

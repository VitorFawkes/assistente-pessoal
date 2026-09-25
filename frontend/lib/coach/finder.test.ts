import { describe, expect, test } from "bun:test";
import { matchMeetings, matchPeople, periodRange } from "./finder";

const SP = "America/Sao_Paulo";
const range = (key: Parameters<typeof periodRange>[0], now: string) => { const r = periodRange(key, SP, new Date(now)); return [r.from.toISOString(), r.to.toISOString()]; };

describe("períodos no fuso do usuário", () => {
 const friday = "2026-09-25T15:30:00Z";
 test("dias, semanas (segunda a domingo) e meses", () => {
  expect(range("hoje", friday)).toEqual(["2026-09-25T03:00:00.000Z", "2026-09-26T03:00:00.000Z"]);
  expect(range("ontem", friday)).toEqual(["2026-09-24T03:00:00.000Z", "2026-09-25T03:00:00.000Z"]);
  expect(range("amanha", friday)).toEqual(["2026-09-26T03:00:00.000Z", "2026-09-27T03:00:00.000Z"]);
  expect(range("esta_semana", friday)).toEqual(["2026-09-21T03:00:00.000Z", "2026-09-28T03:00:00.000Z"]);
  expect(range("semana_passada", friday)).toEqual(["2026-09-14T03:00:00.000Z", "2026-09-21T03:00:00.000Z"]);
  expect(range("proxima_semana", friday)).toEqual(["2026-09-28T03:00:00.000Z", "2026-10-05T03:00:00.000Z"]);
  expect(range("este_mes", friday)).toEqual(["2026-09-01T03:00:00.000Z", "2026-10-01T03:00:00.000Z"]);
  expect(range("mes_passado", friday)).toEqual(["2026-08-01T03:00:00.000Z", "2026-09-01T03:00:00.000Z"]);
  expect(range("ultimos_7_dias", friday)).toEqual(["2026-09-18T15:30:00.000Z", friday.replace("Z", ".000Z")]);
 });
 test("23h30 local ainda é o mesmo dia; domingo fecha a semana; janeiro volta para dezembro", () => {
  expect(range("hoje", "2026-09-26T02:30:00Z")).toEqual(["2026-09-25T03:00:00.000Z", "2026-09-26T03:00:00.000Z"]);
  expect(range("esta_semana", "2026-09-27T15:00:00Z")).toEqual(["2026-09-21T03:00:00.000Z", "2026-09-28T03:00:00.000Z"]);
  expect(range("mes_passado", "2026-01-10T15:00:00Z")).toEqual(["2025-12-01T03:00:00.000Z", "2026-01-01T03:00:00.000Z"]);
 });
});

describe("pessoas citadas na mensagem", () => {
 const pessoas = ["Ana Silva", "Ana Teresa", "Paula", "Sarah", "Sara", "Ângela", "Fer", "Fernanda", "Jo"].map((nome, i) => ({ id: `p${i}`, nome, is_vitor: false }))
  .concat({ id: "eu", nome: "Vitor", is_vitor: true });
 const names = (message: string) => matchPeople(message, pessoas).map(p => p.nome);
 test("primeiro nome acha todas as homônimas; nome completo fica marcado", () => {
  expect(names("quais foram as últimas tarefas que discuti com a Ana?")).toEqual(["Ana Silva", "Ana Teresa"]);
  expect(matchPeople("o que falta com a ana silva", pessoas)).toEqual([{ id: "p0", nome: "Ana Silva", full: true }, { id: "p1", nome: "Ana Teresa", full: false }]);
 });
 test("acentos, palavras inteiras e nomes curtos", () => {
  expect(names("e a angela?")).toEqual(["Ângela"]);
  expect(names("e a Sara?")).toEqual(["Sara"]);
  expect(names("fala com o Fer")).toEqual(["Fer"]);
  expect(names("joana e banana")).toEqual([]);
  expect(names("e o Jo?")).toEqual(["Jo"]);
  expect(names("o que o Vitor tem hoje")).toEqual([]);
 });
});

describe("reuniões citadas na mensagem", () => {
 const meetings = [
  { id: "m1", nome: "Roadmap Trips", original_filename: "online - 20260923 1709.mp3", day: "2026-09-23" },
  { id: "m2", nome: null, original_filename: "x.m4a", day: "2026-09-24" },
 ];
 const ids = (message: string) => matchMeetings(message, meetings, 2026).map(m => m.id);
 test("por título, por nome do arquivo e por data junto de \"reunião\"", () => {
  expect(ids("o que ficou do roadmap trips?")).toEqual(["m1"]);
  expect(ids("resume a online - 20260923 1709")).toEqual(["m1"]);
  expect(ids("o que ficou da reunião de 24/09")).toEqual(["m2"]);
  expect(ids("o que vence em 24/09")).toEqual([]);
  expect(ids("x")).toEqual([]);
 });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { meetingLabel } from "./meeting-label";
import { limparNome, nomearReunioes } from "./nome-curto";

describe("o nome que a IA escreve passa pelo servidor", () => {
 test("tira aspas e ponto, começa com maiúscula", () => {
  expect(limparNome(' "teste de gravação". ')).toBe("Teste de gravação");
  expect(limparNome("Diagnóstico do marketing com Paula")).toBe("Diagnóstico do marketing com Paula");
 });
 test("tira o primeiro nome do dono da conta, sem deixar a frase quebrada", () => {
  expect(limparNome("Remuneração e comissão de Vitor", "Vitor Gambetti")).toBe("Remuneração e comissão");
  expect(limparNome("Vitor e Paula: site novo", "Vitor Gambetti")).toBe("Paula: site novo");
  expect(limparNome("Vitória do time de vendas", "Vitor Gambetti")).toBe("Vitória do time de vendas");
  expect(limparNome("Vitor", "Vitor Gambetti")).toBe("Vitor");
  expect(limparNome("Metas da Júlia", "Júlia Souza")).toBe("Metas");
 });
 test("nome comprido, vazio ou de uma letra não entra", () => {
  expect(limparNome("")).toBeNull();
  expect(limparNome("ok")).toBeNull();
  expect(limparNome("Reunião entre Vitor e Paula focada em diagnóstico do time de marketing e conflitos com vendas")).toBeNull();
 });
 test("o rótulo usa o nome quando existe e o resumo quando não", () => {
  expect(meetingLabel("Reunião entre Vitor e Paula sobre o site novo.", "2026-09-28T13:00:00Z", { nome: "Site novo" })).toBe("28/set · Site novo");
  expect(meetingLabel("Reunião entre Vitor e Paula sobre o site novo.", "2026-09-28T13:00:00Z")).toBe("28/set · Vitor e Paula sobre o site novo");
 });
});

const connection = process.env.COACH_TEST_DATABASE_URL;
describe.skipIf(!connection)("nome curto no banco real: só reunião pronta e sem nome, uma vez", () => {
 const a = randomUUID(), b = randomUUID(), schema = `nomes_test_${randomUUID().replaceAll("-", "")}`;
 let admin: Pool;
 const env = { ...process.env };
 const fetchBefore = globalThis.fetch;
 let chamadas = 0;
 const ids: Record<string, string> = {};
 const row = (id: string) => admin.query("SELECT nome, raw_ai_response FROM meetings WHERE id=$1", [id]).then(r => r.rows[0]);
 beforeAll(async () => {
  const url = new URL(connection!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/coach_test") throw new Error("Only local coach_test allowed");
  admin = new Pool({ connectionString: connection, max: 1, options: `-c search_path=${schema}` });
  await admin.query(`CREATE SCHEMA ${schema};GRANT USAGE ON SCHEMA ${schema} TO app_tenant;
   CREATE TABLE users(id uuid PRIMARY KEY, nome text);
   CREATE TABLE ai_usage(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ref text UNIQUE, user_id uuid, meeting_id uuid, agent text, provider text, model text, source text, input_tokens int, cached_tokens int, cache_write_tokens int, output_tokens int, audio_seconds numeric, cost_usd numeric, basis text, note text, occurred_at timestamptz, recorded_at timestamptz DEFAULT now());
   CREATE TABLE meetings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, status text, nome text, summary text, raw_ai_response jsonb, recorded_at timestamptz, created_at timestamptz DEFAULT now());
   ALTER TABLE meetings ENABLE ROW LEVEL SECURITY; ALTER TABLE meetings FORCE ROW LEVEL SECURITY;
   CREATE POLICY t ON meetings FOR ALL USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ${schema} TO app_tenant;`);
  Object.assign(process.env, { COACH_PROVIDER: "openai", COACH_MODEL: "gpt-6-sol" });
  await admin.query("INSERT INTO users(id,nome) VALUES($1,'Vitor Gambetti'),($2,'Tiago')", [a, b]);
  const ins = (user: string, status: string, summary: string | null, nome: string | null = null, raw: unknown = { summary: "x" }) =>
   admin.query("INSERT INTO meetings(user_id,status,summary,nome,raw_ai_response,recorded_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id", [user, status, summary, nome, raw === null ? null : JSON.stringify(raw)]).then(r => r.rows[0].id as string);
  ids.teste = await ins(a, "done", "Áudio curto e trivial, apenas um teste de gravação sem conteúdo de reunião.");
  ids.aniquinha = await ins(a, "done", "Trecho informal de conversa entre Vitor Gambetti e Aniquinha, misturando assuntos pessoais e um alinhamento de comissão de Vitor com Thiago.", null, null);
  ids.batizada = await ins(a, "done", "Reunião sobre o orçamento de mídia.", "Orçamento de mídia (meu nome)");
  ids.processando = await ins(a, "analyzing", "Ainda sem resumo final.");
  ids.semResumo = await ins(a, "done", null);
  ids.ruim = await ins(a, "done", "Reunião longa sobre muitos assuntos.");
  ids.outraConta = await ins(b, "done", "Reunião do Tiago com a Diana sobre produção.");
  await global.__pgPool?.end(); global.__pgPool = undefined;
  url.username = "app_tenant"; url.password = ""; url.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = url.toString();
  process.env.OPENAI_API_KEY = "synthetic-key";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
   chamadas++;
   const corpo = JSON.parse(String(init?.body));
   const entrada = JSON.parse(corpo.input[1].content) as { dono_da_conta: string; reunioes: { codigo: string; resumo: string }[] };
   const nomes = entrada.reunioes.map(r => ({ codigo: r.codigo, nome: r.resumo.startsWith("Áudio") ? "Teste de gravação." : r.resumo.startsWith("Trecho") ? "Comissão com Thiago e Aniquinha" : "Reunião longa sobre muitos assuntos diferentes que não cabem num nome curto de jeito nenhum" }));
   return Response.json({ status: "completed", model: "gpt-6-luna", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ nomes }) }] }], usage: { input_tokens: 10, output_tokens: 5 } });
  }) as unknown as typeof fetch;
 });
 afterAll(async () => {
  globalThis.fetch = fetchBefore;
  process.env = env;
  await global.__pgPool?.end(); global.__pgPool = undefined;
  await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.end();
 });
 test("dá nome só às prontas sem nome; nunca troca nome dado por pessoa; não mexe em outra conta", async () => {
  expect(await nomearReunioes(a)).toBe(2);
  expect(chamadas).toBe(1);
  expect((await admin.query("SELECT agent, count(*)::int n FROM ai_usage GROUP BY agent")).rows).toEqual([{ agent: "nomes_reunioes", n: 1 }]);
  expect(await row(ids.teste)).toMatchObject({ nome: "Teste de gravação", raw_ai_response: { summary: "x", nome_ia: "Teste de gravação" } });
  expect(await row(ids.aniquinha)).toMatchObject({ nome: "Comissão com Thiago e Aniquinha", raw_ai_response: { nome_ia: "Comissão com Thiago e Aniquinha" } });
  expect((await row(ids.batizada)).nome).toBe("Orçamento de mídia (meu nome)");
  expect((await row(ids.processando)).nome).toBeNull();
  expect((await row(ids.semResumo)).nome).toBeNull();
  expect((await row(ids.outraConta)).nome).toBeNull();
 });
 test("nome que não presta fica anotado para não pagar de novo; a varrida seguinte não chama a IA", async () => {
  expect(await row(ids.ruim)).toMatchObject({ nome: null, raw_ai_response: { nome_ia: "" } });
  expect(await nomearReunioes(a)).toBe(0);
  expect(chamadas).toBe(1);
 });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { recordAiUsage } from "./ai-usage";
import { usageReport } from "./ai-usage-report";

const connection = process.env.COACH_TEST_DATABASE_URL;

describe.skipIf(!connection)("Registro de gastos no banco real: só inclui, nunca apaga, e soma certo", () => {
 const admin = randomUUID(), other = randomUUID(), schema = `usage_test_${randomUUID().replaceAll("-", "")}`;
 const mine = randomUUID(), theirs = randomUUID(), checkinJob = randomUUID(), chatRun = randomUUID(), checkinRun = randomUUID();
 let pool: Pool;
 const env = { ...process.env };
 beforeAll(async () => {
  const url = new URL(connection!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/coach_test") throw new Error("Only local coach_test allowed");
  pool = new Pool({ connectionString: connection, max: 1, options: `-c search_path=${schema}` });
  await pool.query(`CREATE SCHEMA ${schema};GRANT USAGE ON SCHEMA ${schema} TO app_tenant,app_writer;
   CREATE TABLE users(id uuid PRIMARY KEY);
   CREATE TABLE meetings(id uuid PRIMARY KEY,user_id uuid NOT NULL,nome text,original_filename text NOT NULL);
   ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON meetings FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
   CREATE TABLE coach_jobs(id uuid PRIMARY KEY,user_id uuid NOT NULL,kind text NOT NULL);
   CREATE TABLE coach_model_runs(id uuid PRIMARY KEY,user_id uuid NOT NULL,run_key text,purpose text NOT NULL,provider text NOT NULL,model text NOT NULL,
    input_tokens bigint NOT NULL DEFAULT 0,output_tokens bigint NOT NULL DEFAULT 0,cached_input_tokens bigint NOT NULL DEFAULT 0,cache_write_tokens bigint NOT NULL DEFAULT 0,
    usage_complete boolean NOT NULL DEFAULT false,cost_usd numeric(12,6) NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
   GRANT SELECT ON meetings TO app_tenant;`);
  await pool.query("INSERT INTO users(id) VALUES($1),($2)", [admin, other]);
  await pool.query("INSERT INTO meetings(id,user_id,nome,original_filename) VALUES($1,$3,'Roadmap Trips','a.mp3'),($2,$4,'Reunião da outra conta','b.mp3')", [mine, theirs, admin, other]);
  await pool.query("INSERT INTO coach_jobs(id,user_id,kind) VALUES($1,$2,'checkin')", [checkinJob, admin]);
  await pool.query(`INSERT INTO coach_model_runs(id,user_id,run_key,purpose,provider,model,input_tokens,output_tokens,usage_complete,cost_usd,created_at) VALUES
   ($1,$3,'x','chat','openai','gpt-6-sol',10000,300,true,0.023,'2026-09-24T13:00:00Z'),
   ($2,$3,$4,'chat','openai','gpt-6-sol',9000,200,true,0.020,'2026-09-25T11:00:00Z')`, [chatRun, checkinRun, admin, checkinJob]);
  const migration = await readFile(new URL("../../db/0041_ai_usage.sql", import.meta.url), "utf8");
  await pool.query(migration); await pool.query(migration);
  await global.__pgPool?.end(); global.__pgPool = undefined;
  url.username = "app_tenant"; url.password = ""; url.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = url.toString();
 });
 afterAll(async () => {
  process.env = env;
  await global.__pgPool?.end(); global.__pgPool = undefined;
  await pool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool?.end();
 });

 test("the Coach's past calls are copied once; a check-in is told apart by its job", async () => {
  const rows = (await pool.query("SELECT ref,agent,cost_usd,basis FROM ai_usage ORDER BY occurred_at")).rows;
  expect(rows).toEqual([
   { ref: `coach_run:${chatRun}`, agent: "coach_conversa", cost_usd: "0.023000", basis: "medido" },
   { ref: `coach_run:${checkinRun}`, agent: "coach_mensagens", cost_usd: "0.020000", basis: "medido" },
  ]);
 });

 test("the app can add a call once, but never change or erase what was spent", async () => {
  const entry = { ref: "ditado:1", agent: "ditado" as const, source: "app" as const, provider: "openai", model: "gpt-6-luna", userId: admin, meetingId: mine,
   inputTokens: 1000, outputTokens: 100, costUsd: 0.00015, basis: "medido" as const, occurredAt: "2026-09-25T12:00:00Z" };
  expect(await recordAiUsage(entry)).toBe(true);
  expect(await recordAiUsage({ ...entry, costUsd: 99 })).toBe(false);
  const tenant = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
   await expect(tenant.query("UPDATE ai_usage SET cost_usd=0")).rejects.toThrow(/permission denied/);
   await expect(tenant.query("DELETE FROM ai_usage")).rejects.toThrow(/permission denied/);
  } finally { await tenant.end(); }
  expect((await pool.query("SELECT cost_usd FROM ai_usage WHERE ref='ditado:1'")).rows).toEqual([{ cost_usd: "0.000150" }]);
 });

 test("the page adds up by agent and day, compares with the period before, and names only the admin's meetings", async () => {
  await recordAiUsage({ ref: "n8n:x:transcricao", agent: "transcricao", source: "mac", provider: "assemblyai", model: "universal-3-5-pro", userId: other, meetingId: theirs,
   audioSeconds: 2770, costUsd: 0.17697, basis: "estimado", note: "Duração cobrada ≈ fim da última fala.", occurredAt: "2026-09-25T15:00:00Z" });
  const now = new Date("2026-09-25T20:00:00Z");
  const hoje = await usageReport("hoje", "America/Sao_Paulo", admin, now);
  expect(hoje.agentes.map(a => [a.agent, a.usos, +a.custo.toFixed(5), a.estimados])).toEqual([["transcricao", 1, 0.17697, 1], ["coach_mensagens", 1, 0.02, 0], ["ditado", 1, 0.00015, 0]]);
  expect(+hoje.total.toFixed(5)).toBe(0.19712);
  expect(hoje.anterior).toBeCloseTo(0.023, 6);
  expect(hoje.maiores.map(m => m.reuniao)).toEqual(["reunião de outra pessoa", null, "Roadmap Trips"]);
  expect(hoje.maiores[0].detalhe).toBe("46 min de áudio");
  const semana = await usageReport("7d", "America/Sao_Paulo", admin, now);
  expect(semana.dias).toEqual([{ dia: "2026-09-24", custo: 0.023 }, { dia: "2026-09-25", custo: 0.19712 }]);
 });
});

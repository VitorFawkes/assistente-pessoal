import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { getPool, withTenant } from "../db";
import { channelStatus, handleEvent, startLink, unlink, whatsappView } from "./channel";

const connection = process.env.COACH_TEST_DATABASE_URL;
const message = (jid: string, id: string, text: string, alt?: string) => ({ event: "messages.upsert", instance: "coach", data: { key: { remoteJid: jid, remoteJidAlt: alt, fromMe: false, id }, messageType: "conversation", message: { conversation: text } } });

describe.skipIf(!connection)("WhatsApp do coach: vínculo por código, deduplicação e isolamento reais", () => {
 const a = randomUUID(), b = randomUUID(), schema = `wa_test_${randomUUID().replaceAll("-", "")}`;
 let admin: Pool;
 const env = { ...process.env };
 beforeAll(async () => {
  const url = new URL(connection!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/coach_test") throw new Error("Only local coach_test allowed");
  admin = new Pool({ connectionString: connection, max: 1, options: `-c search_path=${schema}` });
  await admin.query(`CREATE SCHEMA ${schema};GRANT USAGE ON SCHEMA ${schema} TO app_tenant,app_writer;
   CREATE TABLE users(id uuid PRIMARY KEY,nome text,is_admin boolean NOT NULL DEFAULT false,deleted_at timestamptz);GRANT SELECT ON users TO app_tenant,app_writer;`);
  const migration = await readFile(new URL("../../../db/0036_whatsapp_coach.sql", import.meta.url), "utf8");
  await admin.query(migration); await admin.query(migration);
  const meetingsMigration = await readFile(new URL("../../../db/0037_whatsapp_reunioes.sql", import.meta.url), "utf8");
  await admin.query(meetingsMigration); await admin.query(meetingsMigration);
  await admin.query("INSERT INTO users(id,nome,is_admin) VALUES($1,'Dono',true),($2,'Outra',true)", [a, b]);
  await global.__pgPool?.end(); global.__pgPool = undefined;
  url.username = "app_tenant"; url.password = ""; url.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = url.toString();
  process.env.WHATSAPP_WEBHOOK_SECRET = "x".repeat(48);
  process.env.EVOLUTION_COACH_URL = "http://127.0.0.1:9"; process.env.EVOLUTION_COACH_KEY = "k".repeat(32);
 });
 afterAll(async () => {
  process.env = env;
  await global.__pgPool?.end(); global.__pgPool = undefined;
  await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.end();
 });

 test("número desconhecido sem código não recebe nada e não deixa rastro", async () => {
  expect(await handleEvent(message("5541911110000@s.whatsapp.net", "w1", "oi, quem é?"))).toBeNull();
  expect((await admin.query("SELECT count(*)::int n FROM whatsapp_messages")).rows[0].n).toBe(0);
  expect((await admin.query("SELECT count(*)::int n FROM whatsapp_links")).rows[0].n).toBe(0);
 });

 test("código certo liga telefone e LID; código usado ou errado não liga", async () => {
  const code = await startLink(a);
  expect((await whatsappView({ id: a, is_admin: true })).code_pending).toBe(true);
  const wrong = code === "000000" ? "111111" : "000000";
  expect(await handleEvent(message("5541922220000@s.whatsapp.net", "w2", wrong))).toBeNull();
  expect((await whatsappView({ id: a, is_admin: true })).linked).toBe(false);
  expect(await handleEvent(message("123456789012@lid", "w3", `Código ${code}`, "5541933330000@s.whatsapp.net"))).toBeNull();
  const link = (await admin.query("SELECT phone,lid,verified_at,code_hash FROM whatsapp_links WHERE user_id=$1", [a])).rows[0];
  expect(link).toMatchObject({ phone: "5541933330000", lid: "123456789012", code_hash: null });
  expect(link.verified_at).not.toBeNull();
  // The confirmation was recorded before sending; the fake server is down, so it stays failed for retry.
  const sent = (await admin.query("SELECT kind,status,to_jid FROM whatsapp_messages WHERE user_id=$1 AND direction='out'", [a])).rows;
  expect(sent).toEqual([{ kind: "link", status: "failed", to_jid: "5541933330000@s.whatsapp.net" }]);
  expect(await handleEvent(message("5541944440000@s.whatsapp.net", "w4", code))).toBeNull();
  expect((await admin.query("SELECT phone FROM whatsapp_links WHERE user_id=$1", [a])).rows[0].phone).toBe("5541933330000");
 });

 test("mensagem do número ligado entra uma vez só, mesmo repetida", async () => {
  const first = await handleEvent(message("123456789012@lid", "w5", "me ajuda a priorizar hoje"));
  expect(first).toEqual({ userId: a, jid: "123456789012@lid" });
  expect(await handleEvent(message("123456789012@lid", "w5", "me ajuda a priorizar hoje"))).toBeNull();
  const rows = (await admin.query("SELECT kind,body,status FROM whatsapp_messages WHERE user_id=$1 AND direction='in'", [a])).rows;
  expect(rows).toEqual([{ kind: "text", body: "me ajuda a priorizar hoje", status: "received" }]);
 });

 test("mensagem própria, de grupo ou de outra instância é ignorada", async () => {
  const own = { ...message("5541933330000@s.whatsapp.net", "w6", "eco"), data: { key: { remoteJid: "5541933330000@s.whatsapp.net", fromMe: true, id: "w6" }, message: { conversation: "eco" } } };
  expect(await handleEvent(own)).toBeNull();
  expect(await handleEvent(message("120363000000000000@g.us", "w7", "no grupo"))).toBeNull();
  expect(await handleEvent({ ...message("5541933330000@s.whatsapp.net", "w8", "outra"), instance: "outra" })).toBeNull();
  expect((await admin.query("SELECT count(*)::int n FROM whatsapp_messages WHERE direction='in'")).rows[0].n).toBe(1);
 });

 test("outra conta não enxerga as mensagens e, ao ligar o mesmo número, tira dela", async () => {
  expect((await withTenant(b, db => db.query("SELECT id FROM whatsapp_messages"))).rows).toEqual([]);
  await expect(withTenant(b, db => db.query("INSERT INTO whatsapp_messages(user_id,direction,kind,body,status) VALUES($1,'in','text','x','received')", [a]))).rejects.toThrow();
  const code = await startLink(b);
  await handleEvent(message("5541933330000@s.whatsapp.net", "w9", code));
  const links = (await admin.query("SELECT user_id,phone,verified_at IS NOT NULL AS verified FROM whatsapp_links ORDER BY user_id=$1 DESC", [a])).rows;
  expect(links).toEqual([{ user_id: a, phone: null, verified: false }, { user_id: b, phone: "5541933330000", verified: true }]);
  expect(await getPool().query("SELECT count(*)::int n FROM whatsapp_links").then(r => r.rows[0].n)).toBe(2);
 });

 test("estado da conexão acompanha os avisos do servidor; desligar limpa o vínculo", async () => {
  await handleEvent({ event: "connection.update", instance: "coach", data: { state: "open" } });
  expect((await channelStatus()).state).toBe("open");
  await handleEvent({ event: "connection.update", instance: "coach", data: { state: "weird" } });
  expect((await channelStatus()).state).toBe("close");
  await unlink(b);
  expect((await whatsappView({ id: b, is_admin: true })).linked).toBe(false);
  expect((await whatsappView({ id: b, is_admin: false })).available).toBe(false);
 });
});

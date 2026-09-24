import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { applyTaskActions, candidateTasks, handleTaskMessage, openProposal, type CandidateTask, type TaskAction } from "./task-actions";

const connection = process.env.COACH_TEST_DATABASE_URL;
const SP = "America/Sao_Paulo";

describe.skipIf(!connection)("Coach mexendo em tarefas: faz, pergunta antes e desfaz, no banco real", () => {
 const a = randomUUID(), b = randomUUID(), schema = `tasks_test_${randomUUID().replaceAll("-", "")}`;
 const mine = randomUUID(), paula = randomUUID(), shared = randomUUID(), other = randomUUID();
 let admin: Pool;
 const env = { ...process.env };
 const row = (id: string) => admin.query("SELECT titulo,owner,acao,status,prazo,prioridade FROM tarefas WHERE id=$1", [id]).then(r => r.rows[0]);
 beforeAll(async () => {
  const url = new URL(connection!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/coach_test") throw new Error("Only local coach_test allowed");
  admin = new Pool({ connectionString: connection, max: 1, options: `-c search_path=${schema}` });
  await admin.query(`CREATE SCHEMA ${schema};GRANT USAGE ON SCHEMA ${schema} TO app_tenant,app_writer;
   CREATE TABLE users(id uuid PRIMARY KEY);
   CREATE TABLE meetings(id uuid PRIMARY KEY,recorded_at timestamptz,created_at timestamptz DEFAULT now(),summary text,nome text,duration_seconds int,meeting_type text);
   CREATE TABLE frentes(id uuid PRIMARY KEY,user_id uuid,nome text);
   CREATE TABLE pessoas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,nome text,updated_at timestamptz,UNIQUE(user_id,nome));
   CREATE TABLE tarefas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,meeting_id uuid,titulo text,descricao text,owner text,is_mine boolean DEFAULT false,acao text DEFAULT 'executar',
    prazo timestamptz,prazo_text text,prioridade text DEFAULT 'media',status text DEFAULT 'aberta',frente_id uuid,frente_proposta text,area_raw text,pessoas_raw jsonb,precisa_revisao boolean DEFAULT false,
    situacao_desde timestamptz,concluida_em timestamptz,cancelada_em timestamptz,parece_com_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(id,user_id));
   CREATE TABLE tarefa_pessoas(tarefa_id uuid,pessoa_id uuid,principal boolean,PRIMARY KEY(tarefa_id,pessoa_id));
   CREATE TABLE tarefa_anexos(id uuid PRIMARY KEY,tarefa_id uuid,tipo text,url text,titulo text,filename text,content_type text,size_bytes int,ordem int,created_at timestamptz);
   CREATE TABLE tarefa_mencoes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tarefa_id uuid,meeting_id uuid,titulo_falado text,evidencia text,owner_falado text,prazo_falado text,prazo_anterior text,origem text,created_at timestamptz DEFAULT now());
   CREATE TABLE tarefa_eventos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tarefa_id uuid,evento text,payload jsonb,created_at timestamptz DEFAULT now());
   CREATE TABLE quadro_tarefas(quadro_id uuid,tarefa_id uuid);
   CREATE TABLE quadro_convidados(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),quadro_id uuid,revoked_at timestamptz);
   CREATE FUNCTION app_slugify(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT lower($1)';
   ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON tarefas FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid)) WITH CHECK(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));
   GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO app_tenant;`);
  const migration = await readFile(new URL("../../../db/0038_coach_task_actions.sql", import.meta.url), "utf8");
  await admin.query(migration); await admin.query(migration);
  await admin.query("INSERT INTO users(id) VALUES($1),($2)", [a, b]);
  const board = randomUUID();
  await admin.query(`INSERT INTO tarefas(id,user_id,titulo,owner,is_mine,acao,prazo) VALUES
   ($1,$5,'Enviar proposta da closer','vitor',true,'executar','2026-09-24T15:00:00Z'),($2,$5,'Contrato do fornecedor','Paula',false,'cobrar',null),
   ($3,$5,'Planilha do quadro','vitor',true,'executar',null),($4,$6,'Tarefa da outra conta','vitor',true,'executar',null)`, [mine, paula, shared, other, a, b]);
  await admin.query("INSERT INTO quadro_tarefas(quadro_id,tarefa_id) VALUES($1,$2)", [board, shared]);
  await admin.query("INSERT INTO quadro_convidados(quadro_id) VALUES($1)", [board]);
  await global.__pgPool?.end(); global.__pgPool = undefined;
  url.username = "app_tenant"; url.password = ""; url.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = url.toString();
 });
 afterAll(async () => {
  process.env = env;
  await global.__pgPool?.end(); global.__pgPool = undefined;
  await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.end();
 });

 test("candidatas trazem as tarefas da conta, marcando o que está em quadro com convidado", async () => {
  const list = await candidateTasks(a, "proposta da closer");
  expect(list[0].titulo).toBe("Enviar proposta da closer");
  expect(list.map(t => t.titulo)).not.toContain("Tarefa da outra conta");
  expect(list.find(t => t.id === shared)?.shared).toBe(true);
 });

 test("tarefa sua muda direto, fica no histórico como Coach e 'desfaz' volta como estava", async () => {
  const tasks = new Map<string, CandidateTask>((await candidateTasks(a, "")).map(t => [t.id, t]));
  const actions: TaskAction[] = [
   { type: "reschedule", tarefa_id: mine, quote: "adia", due_date: "2026-09-25", owner: null, title: null, priority: null },
   { type: "create", tarefa_id: null, quote: "adia", due_date: null, owner: "Pedro", title: "Ligar para o Pedro", priority: null },
  ];
  const lines = await applyTaskActions(a, actions, tasks, SP, "run-1");
  expect(lines).toEqual(['Novo prazo de "Enviar proposta da closer": sex, 25/09.', 'Criei "Ligar para o Pedro", com Pedro.']);
  expect((await row(mine)).prazo.toISOString()).toBe("2026-09-25T15:00:00.000Z");
  const created = (await admin.query("SELECT id,owner,acao FROM tarefas WHERE titulo='Ligar para o Pedro'")).rows[0];
  expect(created).toMatchObject({ owner: "Pedro", acao: "cobrar" });
  expect((await admin.query("SELECT payload->>'origem' AS origem FROM tarefa_eventos WHERE tarefa_id=$1", [created.id])).rows[0].origem).toBe("coach");
  // The same run applied twice does not repeat the changes.
  expect(await applyTaskActions(a, actions, tasks, SP, "run-1")).toEqual([]);
  const undo = await handleTaskMessage(a, "desfaz", [], SP);
  expect(undo).toEqual({ reply: 'Cancelei "Ligar para o Pedro", que eu tinha criado.\n"Enviar proposta da closer" voltou como estava.' });
  expect((await row(mine)).prazo.toISOString()).toBe("2026-09-24T15:00:00.000Z");
  expect((await row(created.id)).status).toBe("cancelada");
  expect(await handleTaskMessage(a, "desfaz", [], SP)).toEqual({ reply: "Não encontrei mudança minha nas últimas 24 horas para desfazer." });
 });

 test("proposta para tarefa de outra pessoa só roda com 'sim'; 'não' descarta; outra conta não vê", async () => {
  await admin.query("INSERT INTO coach_task_proposals(user_id,actions,summary,expires_at) VALUES($1,$2::jsonb,'Posso?',now()+interval '1 hour')",
   [a, JSON.stringify([{ type: "complete", tarefa_id: paula, quote: "conclui", due_date: null, owner: null, title: null, priority: null }])]);
  expect(await openProposal(b)).toBeNull();
  expect((await openProposal(a))?.summary).toBe("Posso?");
  expect(await handleTaskMessage(a, "sim", [], SP)).toEqual({ reply: 'Concluí "Contrato do fornecedor".\nSe não era isso, responda "desfaz".' });
  expect((await row(paula)).status).toBe("concluida");
  expect(await openProposal(a)).toBeNull();
  await admin.query("INSERT INTO coach_task_proposals(user_id,actions,summary,expires_at) VALUES($1,$2::jsonb,'Posso?',now()+interval '1 hour')",
   [a, JSON.stringify([{ type: "cancel", tarefa_id: shared, quote: "cancela", due_date: null, owner: null, title: null, priority: null }])]);
  expect(await handleTaskMessage(a, "não", [], SP)).toEqual({ reply: "Tudo bem, não mudei nada." });
  expect((await row(shared)).status).toBe("aberta");
 });

 test("uma conta não mexe em tarefa de outra", async () => {
  const lines = await applyTaskActions(a, [{ type: "complete", tarefa_id: other, quote: "x", due_date: null, owner: null, title: null, priority: null }], new Map(), SP);
  expect(lines).toEqual([]);
  expect((await row(other)).status).toBe("aberta");
 });
});

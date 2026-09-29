import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { PlannedQuery } from "./assistant-types";
import { resolveEntities, runQueries } from "./finder";

const connection = process.env.COACH_TEST_DATABASE_URL;
const SP = "America/Sao_Paulo";
const now = new Date("2026-09-25T15:00:00Z");
const q = (tipo: PlannedQuery["tipo"], extra: Partial<PlannedQuery> = {}): PlannedQuery => ({ tipo, pessoa: null, reuniao: null, busca: "", periodo: null, campo: "prazo", status: "abertas", ordem: "prazo", ...extra });

describe.skipIf(!connection)("Busca do assistente: consultas fixas no banco real, só da conta certa", () => {
 const a = randomUUID(), b = randomUUID(), schema = `finder_test_${randomUUID().replaceAll("-", "")}`;
 const ana = randomUUID(), anaT = randomUUID(), paula = randomUUID(), eu = randomUUID(), anaB = randomUUID();
 const mAna = randomUUID(), mSprint = randomUUID(), mOld = randomUUID(), mB = randomUUID();
 let admin: Pool;
 const env = { ...process.env };
 const opts = (people: { id: string; nome: string }[] = []) => ({ timezone: SP, now, selfPersonIds: [eu], people: people.map(p => ({ ...p, tarefas: 0, ultima_reuniao: null })) });
 beforeAll(async () => {
  const url = new URL(connection!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/coach_test") throw new Error("Only local coach_test allowed");
  admin = new Pool({ connectionString: connection, max: 1, options: `-c search_path=${schema}` });
  const tenant = (t: string) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;CREATE POLICY tenant ON ${t} FOR ALL USING(user_id=(SELECT nullif(current_setting('app.current_user_id',true),'')::uuid));`;
  await admin.query(`CREATE SCHEMA ${schema};GRANT USAGE ON SCHEMA ${schema} TO app_tenant,app_writer;
   CREATE TABLE users(id uuid PRIMARY KEY);
   CREATE TABLE meetings(id uuid PRIMARY KEY,user_id uuid NOT NULL,nome text,original_filename text NOT NULL,recorded_at timestamptz,status text DEFAULT 'done',summary text,raw_ai_response jsonb,
    transcription text,segments jsonb,speaker_labels jsonb,speaker_pessoas jsonb NOT NULL DEFAULT '{}');
   CREATE TABLE pessoas(id uuid PRIMARY KEY,user_id uuid NOT NULL,nome text NOT NULL,is_vitor boolean DEFAULT false,UNIQUE(user_id,nome));
   CREATE TABLE tarefas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,meeting_id uuid,titulo text NOT NULL,descricao text,owner text,is_mine boolean DEFAULT false,acao text DEFAULT 'executar',
    prazo timestamptz,prioridade text DEFAULT 'media',status text DEFAULT 'aberta',concluida_em timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
   CREATE TABLE tarefa_pessoas(tarefa_id uuid,pessoa_id uuid,principal boolean DEFAULT false,PRIMARY KEY(tarefa_id,pessoa_id));
   CREATE TABLE coach_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,role text NOT NULL,content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
   ${tenant("meetings")}${tenant("pessoas")}${tenant("tarefas")}${tenant("coach_messages")}
   GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO app_tenant;`);
  await admin.query("INSERT INTO users(id) VALUES($1),($2)", [a, b]);
  await admin.query(`INSERT INTO pessoas(id,user_id,nome,is_vitor) VALUES($1,$6,'Ana Silva',false),($2,$6,'Ana Teresa',false),($3,$6,'Paula',false),($4,$6,'Vitor',true),($5,$7,'Ana Silva',false)`, [ana, anaT, paula, eu, anaB, a, b]);
  const segments = JSON.stringify([{ speaker: "A", start: 0, end: 30, text: "Vou desligar o Active para o comercial quando o CRM entrar." }, { speaker: "B", start: 30, end: 60, text: "Combinado, eu cuido do roadmap de Trips." }]);
  await admin.query(`INSERT INTO meetings(id,user_id,nome,original_filename,recorded_at,summary,raw_ai_response,transcription,segments,speaker_labels,speaker_pessoas) VALUES
   ($1,$5,'Roadmap Trips','online - 20260923 1709.mp3','2026-09-23T18:19:00Z','Resumo curto','{"executive_summary":"Relatório: Ana fica com o roadmap de Trips e o Active sai do comercial."}',
    'Vou desligar o Active para o comercial quando o CRM entrar. Combinado, eu cuido do roadmap de Trips.',$7::jsonb,'{"A":"Vitor","B":"Ana Silva"}',$8::jsonb),
   ($2,$5,'Sprint','sprint.m4a','2026-09-24T13:00:00Z','Planejamento da semana',NULL,'planejamento da semana com a equipe',NULL,NULL,$9::jsonb),
   ($3,$5,NULL,'antiga.m4a','2026-07-30T16:24:00Z','Reunião antiga sobre orçamento',NULL,'orçamento do trimestre',NULL,NULL,'{}'),
   ($4,$6,'Roadmap Trips','b.m4a','2026-09-24T12:00:00Z','Da outra conta: Active',NULL,'Active da outra conta',NULL,NULL,$10::jsonb)`,
   [mAna, mSprint, mOld, mB, a, b, segments, JSON.stringify({ A: eu, B: ana }), JSON.stringify({ A: paula }), JSON.stringify({ A: anaB })]);
  const t = Array.from({ length: 6 }, () => randomUUID());
  await admin.query(`INSERT INTO tarefas(id,user_id,meeting_id,titulo,owner,is_mine,acao,prazo,status,concluida_em,created_at) VALUES
   ($1,$7,$9,'Definir roadmap e protótipo da nova experiência digital de Trips','Ana Silva',false,'cobrar','2026-09-30T15:00:00Z','aberta',NULL,'2026-09-23T19:00:00Z'),
   ($2,$7,$10,'Revisar orçamento do trimestre','Vitor',true,'executar','2026-09-20T15:00:00Z','aberta',NULL,'2026-09-24T14:00:00Z'),
   ($3,$7,NULL,'Desligar o Active para o comercial','Vitor',true,'executar','2026-09-25T20:00:00Z','aberta',NULL,'2026-07-20T12:00:00Z'),
   ($4,$7,$11,'Fechar contrato antigo','Ana Silva',false,'cobrar',NULL,'concluida','2026-09-24T18:00:00Z','2026-07-30T17:00:00Z'),
   ($5,$7,NULL,'Alinhar metas de marketing','Paula',false,'cobrar',NULL,'aberta',NULL,'2026-09-10T12:00:00Z'),
   ($6,$8,$12,'Tarefa da outra conta com Ana','Ana Silva',false,'cobrar','2026-09-25T20:00:00Z','aberta',NULL,'2026-09-24T12:00:00Z')`,
   [...t, a, b, mAna, mSprint, mOld, mB]);
  // "Revisar orçamento" belongs to Vitor but involves Ana; it came from the Sprint meeting, where Ana did not speak.
  await admin.query("INSERT INTO tarefa_pessoas(tarefa_id,pessoa_id,principal) VALUES($1,$3,true),($2,$3,false),($4,$5,true)", [t[0], t[1], ana, t[4], paula]);
  await admin.query("INSERT INTO tarefa_pessoas(tarefa_id,pessoa_id,principal) VALUES($1,$2,true)", [t[5], anaB]);
  // One old conversation about the budget, then 24 recent messages (already in the Coach's history), one of them also about it.
  await admin.query(`INSERT INTO coach_messages(user_id,role,content,created_at) VALUES($1,'user','Estou travado no orçamento do trimestre com o financeiro','2026-08-01T12:00:00Z'),
   ($2,'user','Orçamento da outra conta','2026-08-01T12:00:00Z')`, [a, b]);
  await admin.query(`INSERT INTO coach_messages(user_id,role,content,created_at) SELECT $1,'user',CASE WHEN i=1 THEN 'orçamento de novo' ELSE 'mensagem '||i END,'2026-09-20T12:00:00Z'::timestamptz+i*interval '1 minute' FROM generate_series(1,24) i`, [a]);
  await global.__pgPool?.end(); global.__pgPool = undefined;
  url.username = "app_tenant"; url.password = ""; url.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = url.toString();
 });
 afterAll(async () => {
  process.env = env;
  await global.__pgPool?.end(); global.__pgPool = undefined;
  await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.end();
 });

 test("acha as pessoas e a reunião citadas, com contagem e última reunião, sem o próprio usuário", async () => {
  const found = await resolveEntities(a, "o que ficou com a Ana e com o Vitor na reunião de 23/09?", { timezone: SP, now });
  expect(found.people.map(p => p.nome)).toEqual(["Ana Silva", "Ana Teresa"]);
  expect(found.people[0]).toMatchObject({ id: ana, tarefas: 3, ultima_reuniao: "2026-09-23T18:19:00.000Z" });
  expect(found.people[1]).toMatchObject({ id: anaT, tarefas: 0, ultima_reuniao: null });
  expect(found.meetings).toEqual([{ id: mAna, titulo: "Roadmap Trips", recorded_at: "2026-09-23T18:19:00.000Z" }]);
  expect((await resolveEntities(b, "e a Ana?", { timezone: SP, now })).people.map(p => p.id)).toEqual([anaB]);
 });

 test("tarefas da pessoa: responsável e envolvida, da mais nova, sem vazar a outra conta", async () => {
  const d = await runQueries(a, [q("tarefas_da_pessoa", { pessoa: ana, status: "todas", ordem: "recentes" }), q("tarefas_da_pessoa", { pessoa: ana })], opts([{ id: ana, nome: "Ana Silva" }]));
  const [todas, abertas] = d.consultas;
  expect(todas.tarefas!.map(t => [t.titulo, t.ligacao])).toEqual([
   ["Revisar orçamento do trimestre", "envolvida"], ["Definir roadmap e protótipo da nova experiência digital de Trips", "responsavel"], ["Fechar contrato antigo", "responsavel"]]);
  expect(todas.tarefas![1].reuniao).toEqual({ titulo: "Roadmap Trips", data: "2026-09-23T18:19:00.000Z" });
  expect(todas).toMatchObject({ total: 3, mostrados: 3 });
  expect(abertas.tarefas!.map(t => t.titulo)).toEqual(["Revisar orçamento do trimestre", "Definir roadmap e protótipo da nova experiência digital de Trips"]);
  expect(JSON.stringify(d)).not.toContain("outra conta");
 });

 test("reuniões da pessoa: onde falou e de onde vieram tarefas ligadas a ela, com participantes e relatório", async () => {
  const [r] = (await runQueries(a, [q("reunioes_da_pessoa", { pessoa: ana })], opts())).consultas;
  expect(r.reunioes!.map(m => [m.titulo, m.ligacao])).toEqual([["Sprint", "tarefas_ligadas"], ["Roadmap Trips", "participou"]]);
  expect(r.reunioes![1]).toMatchObject({ participantes: ["Vitor", "Ana Silva"], resumo: "Relatório: Ana fica com o roadmap de Trips e o Active sai do comercial.", resumo_parcial: false });
  expect(r.total).toBe(2);
 });

 test("detalhe, assunto, período e trechos com fonte", async () => {
  const d = await runQueries(a, [
   q("detalhe_da_reuniao", { reuniao: mAna }), q("reunioes_por_assunto", { busca: "Active" }), q("tarefas_do_periodo", { periodo: "esta_semana", campo: "conclusao", status: "todas" }),
   q("trechos", { busca: "desligar o Active", reuniao: mAna }),
  ], opts());
  const [detalhe, assunto, periodo, trechos] = d.consultas;
  expect(detalhe.reunioes![0].tarefas!.map(t => t.titulo)).toEqual(["Definir roadmap e protótipo da nova experiência digital de Trips"]);
  expect(assunto.reunioes!.map(m => m.id)).toEqual([mAna]);
  expect(periodo.tarefas!.map(t => t.titulo)).toEqual(["Fechar contrato antigo"]);
  expect(trechos.trechos![0]).toMatchObject({ meeting_id: mAna, titulo: "Roadmap Trips" });
  expect(trechos.trechos![0].texto).toContain("desligar o Active");
  expect(trechos.trechos![0].source_ids.length).toBeGreaterThan(0);
  expect(d.excerpts.map(e => e.meeting.id)).toEqual([mAna]);
 });

 test("pendências de hoje, reunião de ontem e busca com texto qualquer", async () => {
  const d = await runQueries(a, [q("pendencias"), q("reunioes_do_periodo", { periodo: "ontem" }), q("tarefas_por_assunto", { busca: "a o & | ! ( ' :* active" }), q("agenda")], opts());
  const [pend, ontem, assunto, agenda] = d.consultas;
  expect(pend.pendencias).toMatchObject({ vence_hoje: 1, atrasadas: 1 });
  expect(ontem.reunioes!.map(m => m.titulo)).toEqual(["Sprint"]);
  expect(ontem.reunioes![0].participantes).toEqual(["Paula"]);
  expect(assunto.tarefas!.map(t => t.titulo)).toEqual(["Desligar o Active para o comercial"]);
  expect(agenda.agenda_status).not.toBe("connected");
  expect(agenda.eventos).toEqual([]);
 });

 test("conversas antigas com o Coach: só as que não estão no histórico recente, só da conta", async () => {
  const [c] = (await runQueries(a, [q("conversas", { busca: "orçamento" })], opts())).consultas;
  expect(c.conversas).toEqual([{ papel: "usuario", data: "2026-08-01T12:00:00.000Z", texto: "Estou travado no orçamento do trimestre com o financeiro" }]);
 });

 test("no máximo 4 consultas; faltou dado ou falhou vira aviso e as outras seguem", async () => {
  const d = await runQueries(a, [q("tarefas_da_pessoa"), q("detalhe_da_reuniao", { reuniao: "nao-e-uuid" }), q("reunioes_do_periodo", { periodo: "mes_passado" }), q("pendencias"), q("agenda")], opts());
  expect(d.consultas.map(c => c.tipo)).toEqual(["tarefas_da_pessoa", "detalhe_da_reuniao", "reunioes_do_periodo", "pendencias"]);
  expect(d.consultas[0].aviso).toContain("sem pessoa");
  expect(d.consultas[1].aviso).toContain("falhou");
  expect(d.consultas[2].reunioes).toEqual([]);
  expect(d.consultas[3].pendencias!.atrasadas).toBe(1);
 });
});

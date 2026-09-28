import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { buildDossier } from "./assistant";
import { runQueries } from "./finder";
import { applyTaskActions, candidateTasks, expandBulk, handleTaskMessage, openProposal, validateBulk, type CandidateTask, type TaskAction, type TaskNotes } from "./task-actions";
import { emptyFilter, filterContext, selectTasks, type TaskFilter } from "./task-filter";

const connection = process.env.COACH_TEST_DATABASE_URL;
const SP = "America/Sao_Paulo";

/** The interpreter's answer for one message, as the model would write it (every field present, like the strict schema). */
const blank = { type: "complete", due_date: "", days: 0, owner: "", wait: false, priority: "", order: "prazo", quote: "",
 all: false, status: "open", due: "", due_from: "", due_until: "", who: "", people: [], not_people: [], kind: "", priorities: [], boards: [], not_boards: [], areas: [], not_areas: [],
 meetings: [], meeting_from: "", meeting_until: "", source: "", words: [], not_words: [], created_from: "", created_until: "", closed_from: "", closed_until: "", idle_days: 0, repeated: false, except: [] };
const bulk = (b: Partial<Record<string, unknown>>) => ({ ...blank, ...b });
const reply = (out: Record<string, unknown>) => ({ intent: "actions", actions: [], bulk: [], question: "", unsupported: "", also_reply: false, ask_first: false, lane: "tarefas", ...out });
const filter = (f: Partial<TaskFilter>): TaskFilter => ({ ...emptyFilter(), ...f });

describe.skipIf(!connection)("Coach mexendo em tarefas: faz na hora, pergunta só quando pedem e desfaz, no banco real", () => {
 const a = randomUUID(), b = randomUUID(), schema = `tasks_test_${randomUUID().replaceAll("-", "")}`;
 const mine = randomUUID(), paula = randomUUID(), shared = randomUUID(), other = randomUUID();
 let admin: Pool;
 const env = { ...process.env };
 const fetchBefore = globalThis.fetch;
 const sent: { message: string; data: Record<string, unknown> }[] = [];
 const row = (id: string) => admin.query("SELECT titulo,owner,acao,status,prazo,prioridade FROM tarefas WHERE id=$1", [id]).then(r => r.rows[0]);
 const insert = (user: string, titulo: string, extra: Partial<{ owner: string; is_mine: boolean; acao: string; prazo: string | null; status: string; prioridade: string; meeting_id: string; frente_proposta: string; frente_id: string; created_at: string; updated_at: string; parece_com_id: string }> = {}) => {
  const t = { owner: "vitor", is_mine: true, acao: "executar", prazo: null, status: "aberta", prioridade: "media", ...extra };
  const cols = Object.keys(t), values = Object.values(t);
  return admin.query(`INSERT INTO tarefas(user_id,titulo,${cols.join(",")}) VALUES($1,$2,${cols.map((_, i) => `$${i + 3}`).join(",")}) RETURNING id`, [user, titulo, ...values]).then(r => r.rows[0].id as string);
 };
 /** The next model call answers `out`; every call records what the interpreter received. */
 const interpreter = (out: Record<string, unknown> | ((data: Record<string, unknown>) => Record<string, unknown>)) => {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
   const data = JSON.parse(JSON.parse(String(init?.body)).input[1].content) as Record<string, unknown>;
   sent.push({ message: String(data.message), data });
   const text = JSON.stringify(typeof out === "function" ? out(data) : out);
   return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 10, output_tokens: 5 } });
  }) as unknown as typeof fetch;
 };
 beforeAll(async () => {
  const url = new URL(connection!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/coach_test") throw new Error("Only local coach_test allowed");
  admin = new Pool({ connectionString: connection, max: 1, options: `-c search_path=${schema}` });
  await admin.query(`CREATE SCHEMA ${schema};GRANT USAGE ON SCHEMA ${schema} TO app_tenant,app_writer;
   CREATE TABLE users(id uuid PRIMARY KEY);
   CREATE TABLE meetings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,status text DEFAULT 'done',original_filename text DEFAULT 'gravacao.m4a',speaker_pessoas jsonb DEFAULT '{}',recorded_at timestamptz,created_at timestamptz DEFAULT now(),summary text,nome text,duration_seconds int,meeting_type text);
   CREATE TABLE frentes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,nome text,ativo boolean DEFAULT true);
   CREATE TABLE pessoas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,nome text,aliases text[] DEFAULT '{}',is_vitor boolean DEFAULT false,updated_at timestamptz,UNIQUE(user_id,nome));
   CREATE TABLE tarefas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,meeting_id uuid,titulo text,descricao text,owner text,is_mine boolean DEFAULT false,acao text DEFAULT 'executar',
    prazo timestamptz,prazo_text text,prioridade text DEFAULT 'media' CHECK(prioridade IN ('baixa','media','alta','urgente')),status text DEFAULT 'aberta',frente_id uuid,frente_proposta text,area_raw text,pessoas_raw jsonb,precisa_revisao boolean DEFAULT false,
    situacao_desde timestamptz,concluida_em timestamptz,cancelada_em timestamptz,parece_com_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(id,user_id));
   CREATE TABLE tarefa_pessoas(tarefa_id uuid,pessoa_id uuid,principal boolean,PRIMARY KEY(tarefa_id,pessoa_id));
   CREATE TABLE tarefa_anexos(id uuid PRIMARY KEY,tarefa_id uuid,tipo text,url text,titulo text,filename text,content_type text,size_bytes int,ordem int,created_at timestamptz);
   CREATE TABLE tarefa_mencoes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tarefa_id uuid,meeting_id uuid,titulo_falado text,evidencia text,owner_falado text,prazo_falado text,prazo_anterior text,origem text,created_at timestamptz DEFAULT now());
   CREATE TABLE tarefa_eventos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tarefa_id uuid,evento text,payload jsonb,created_at timestamptz DEFAULT now());
   CREATE TABLE quadros(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,nome text,archived_at timestamptz);
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
  await admin.query("INSERT INTO quadros(id,user_id,nome) VALUES($1,$2,'Mkt Performance')", [board, a]);
  await admin.query("INSERT INTO quadro_tarefas(quadro_id,tarefa_id) VALUES($1,$2)", [board, shared]);
  await admin.query("INSERT INTO quadro_convidados(quadro_id) VALUES($1)", [board]);
  await global.__pgPool?.end(); global.__pgPool = undefined;
  url.username = "app_tenant"; url.password = ""; url.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = url.toString();
  Object.assign(process.env, { OPENAI_API_KEY: "synthetic-key", COACH_PROVIDER: "openai", COACH_MODEL: "gpt-6-sol" });
  delete process.env.COACH_TASKS_MODEL; delete process.env.COACH_TASKS_PROVIDER;
 });
 afterAll(async () => {
  globalThis.fetch = fetchBefore;
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
  expect(lines).toEqual(['Criei "Ligar para o Pedro", com Pedro.', 'Novo prazo de "Enviar proposta da closer": sex, 25/09.']);
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

 test("pergunta guardada só roda com 'sim'; 'não' descarta; outra conta não vê", async () => {
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

 test("pedido em lote acha todas até a data, de qualquer pessoa como o app, e faz na hora: diz o critério, de quem eram e deixa o 'desfaz'", async () => {
  for (let i = 0; i < 9; i++) await insert(a, `Atrasada ${i + 1}`, { prazo: `2026-09-${10 + i}T15:00:00Z`, ...(i % 3 ? {} : { owner: "Tiago", is_mine: false, acao: "cobrar" }) });
  const waiting = await insert(a, "Da Giordana, que você só aguarda", { owner: "Giordana", is_mine: false, acao: "aguardar", prazo: "2026-09-20T15:00:00Z" });
  const today = await insert(a, "Agente de gravação", { prazo: "2026-09-28T15:00:00Z" });
  const otherAccount = await insert(b, "Atrasada da outra conta", { prazo: "2026-09-20T15:00:00Z" });
  const expected = (await admin.query("SELECT id FROM tarefas WHERE user_id=$1 AND status IN ('aberta','em_andamento','aguardando_aprovacao') AND prazo<'2026-09-25T03:00:00Z' ORDER BY prazo,id", [a])).rows.map(r => r.id as string);
  expect(expected).toContain(waiting);
  expect(expected.length).toBeGreaterThan(6);
  const now = new Date("2026-09-28T13:00:00Z");
  const message = "Pode marcar como feitas TODAS do dia 24/09 pra trás";
  interpreter(reply({ bulk: [bulk({ due: "range", due_until: "2026-09-24", quote: message })] }));
  const answer = await handleTaskMessage(a, message, [], SP, now, "run-lote") as { reply: string };
  const lines = answer.reply.split("\n");
  expect(lines[0]).toMatch(new RegExp(`^Concluí ${expected.length} tarefas com prazo até 24/09 \\(\\d+ suas, \\d+ para você cobrar e 1 que você aguardava\\):$`));
  expect(answer.reply).toContain("Da Giordana");
  expect(answer.reply).not.toContain("Posso fazer?");
  expect(lines.at(-1)).toBe('Se não era isso, responda "desfaz".');
  for (const id of expected) expect((await row(id)).status).toBe("concluida");
  for (const id of [today, otherAccount]) expect((await row(id)).status).toBe("aberta");
  expect(await openProposal(a, now)).toBeNull();

  // "Não era isso" right after the change undoes it, like "desfaz".
  const undo = await handleTaskMessage(a, "não era isso", [{ role: "user", content: message }, { role: "assistant", content: answer.reply }], SP, now) as { reply: string };
  expect(undo.reply.split("\n")[0]).toBe(`Voltei ${expected.length} tarefas como estavam:`);
  for (const id of expected) expect((await row(id)).status).toBe("aberta");
 });

 test("quem pede para ver antes recebe a pergunta com o total; o 'sim' com mais texto aplica tudo e lê o resto depois", async () => {
  const expected = (await admin.query("SELECT id FROM tarefas WHERE user_id=$1 AND status IN ('aberta','em_andamento','aguardando_aprovacao') AND prazo<'2026-09-25T03:00:00Z' ORDER BY prazo,id", [a])).rows.map(r => r.id as string);
  const now = new Date("2026-09-28T13:00:00Z");
  const message = "Conclui todas do dia 24/09 pra trás, mas me mostra antes";
  interpreter(reply({ bulk: [bulk({ due: "range", due_until: "2026-09-24", quote: message })], ask_first: true }));
  const asked = await handleTaskMessage(a, message, [], SP, now, "run-ver-antes") as { reply: string };
  expect(asked.reply.split("\n")[0]).toMatch(new RegExp(`^Vou concluir ${expected.length} tarefas com prazo até 24/09\\. São \\d+ suas, \\d+ para você cobrar e 1 que você está aguardando\\. Posso fazer\\?$`));
  expect((await openProposal(a, now))?.actions.map(x => x.tarefa_id).sort()).toEqual([...expected].sort());
  expect((await row(expected[0])).status).toBe("aberta");

  interpreter(reply({ intent: "none", also_reply: true }));
  const confirmed = await handleTaskMessage(a, "Sim\nPode fazer TUDO e já me mostra as que sobraram", [], SP, now, "run-sim");
  expect(confirmed).toMatchObject({ waiting: [], lane: "tarefas" });
  const done = (confirmed as TaskNotes).done;
  expect(done[0]).toBe(`Concluí ${expected.length} tarefas:`);
  expect(done.at(-1)).toBe('Se não era isso, responda "desfaz".');
  // The rest of the message is read after the change, alone.
  expect(sent.at(-1)!.message).toBe("já me mostra as que sobraram");
  for (const id of expected) expect((await row(id)).status).toBe("concluida");
  expect(await openProposal(a, now)).toBeNull();

  const undo = await handleTaskMessage(a, "desfaz", [], SP, now) as { reply: string };
  expect(undo.reply.split("\n")[0]).toBe(`Voltei ${expected.length} tarefas como estavam:`);
  for (const id of expected) expect((await row(id)).status).toBe("aberta");
 });

 test("tarefa de outra pessoa e de quadro com convidado mudam na hora, citadas uma a uma", async () => {
  const message = "conclui o contrato do fornecedor e a planilha do quadro";
  interpreter(data => {
   const code = (title: string) => (data.tasks as { task: string; title: string }[]).find(t => t.title === title)!.task;
   const one = (task: string) => ({ type: "complete", task, quote: message, due_date: "", owner: "", title: "", priority: "", check: false, wait: false });
   return reply({ actions: [one(code("Contrato do fornecedor")), one(code("Planilha do quadro"))] });
  });
  await admin.query("UPDATE tarefas SET status='aberta' WHERE id=ANY($1::uuid[])", [[paula, shared]]);
  const answer = await handleTaskMessage(a, message, [], SP, new Date("2026-09-28T13:00:00Z"), "run-outra-pessoa") as { reply: string };
  expect(answer.reply).toBe('Concluí "Contrato do fornecedor".\nConcluí "Planilha do quadro".\nSe não era isso, responda "desfaz".');
  expect((await row(paula)).status).toBe("concluida");
  expect((await row(shared)).status).toBe("concluida");
  await handleTaskMessage(a, "desfaz", [], SP);
  expect((await row(paula)).status).toBe("aberta");
  expect((await row(shared)).status).toBe("aberta");
 });

 test("relato de parte de uma tarefa sua vira pergunta; 'sim' conclui", async () => {
  const task = await insert(a, "Disponibilizar o agente de gravação e apresentar a solução", { prazo: "2026-09-28T15:00:00Z" });
  const now = new Date("2026-09-28T14:00:00Z");
  const message = "já disponibilizei o agente de gravação";
  interpreter(data => {
   const code = (data.tasks as { task: string; title: string }[]).find(t => t.title.startsWith("Disponibilizar o agente"))!.task;
   return reply({ actions: [{ type: "complete", task: code, quote: message, due_date: "", owner: "", title: "", priority: "", check: true, wait: false }] });
  });
  expect(await handleTaskMessage(a, message, [], SP, now, "run-parte")).toEqual({ reply: 'Pelo que você contou, "Disponibilizar o agente de gravação e apresentar a solução" pode estar feita. Quer que eu conclua?\nResponda sim ou não.' });
  expect((await row(task)).status).toBe("aberta");
  expect(await handleTaskMessage(a, "sim", [], SP, now, "run-parte-sim")).toEqual({ reply: 'Concluí "Disponibilizar o agente de gravação e apresentar a solução".\nSe não era isso, responda "desfaz".' });
  expect((await row(task)).status).toBe("concluida");
 });

 test("uma conta não mexe em tarefa de outra", async () => {
  const lines = await applyTaskActions(a, [{ type: "complete", tarefa_id: other, quote: "x", due_date: null, owner: null, title: null, priority: null }], new Map(), SP);
  expect(lines).toEqual([]);
  expect((await row(other)).status).toBe("aberta");
 });

 describe("'conclui TODAS sem prazo, de qualquer responsável' (28/09): o pedido inteiro, sem corte e sem pergunta sem saída", () => {
  const user = randomUUID();
  const ids: Record<string, string> = {};
  const now = new Date("2026-09-28T15:00:00Z");
  beforeAll(async () => {
   await admin.query("INSERT INTO users(id) VALUES($1)", [user]);
   // 130 of the user's own tasks without a deadline: more than the old 80-task cut.
   for (let i = 0; i < 130; i++) await insert(user, `Sua sem prazo ${String(i + 1).padStart(3, "0")}`);
   ids.cobrar = await insert(user, "Cobrar o organograma do Tiago", { owner: "Tiago", is_mine: false, acao: "cobrar" });
   ids.aguardar = await insert(user, "Giordana manda o relatório", { owner: "Giordana", is_mine: false, acao: "aguardar" });
   ids.ninguem = await insert(user, "Alguém revisa o contrato", { owner: "?", is_mine: false, acao: "cobrar" });
   ids.comPrazo = await insert(user, "Com prazo, fica", { prazo: "2026-10-02T15:00:00Z" });
   ids.fechada = await insert(user, "Já concluída, fica", { status: "concluida" });
   ids.outraConta = await insert(b, "Sem prazo da outra conta");
  });
  test("faz na hora com o total certo e os tipos, numa mudança só; 'desfaz' volta todas", async () => {
   const expected = (await admin.query("SELECT id FROM tarefas WHERE user_id=$1 AND status='aberta' AND prazo IS NULL", [user])).rows.map(r => r.id as string);
   expect(expected).toHaveLength(133);
   const message = "Pode concluir TODAS sem prazo";
   interpreter(reply({ bulk: [bulk({ due: "none", quote: message })] }));
   const done = await handleTaskMessage(user, message, [], SP, now, "run-sem-prazo") as { reply: string };
   const lines = done.reply.split("\n");
   expect(lines[0]).toBe("Concluí 133 tarefas sem prazo (130 suas, 2 para você cobrar e 1 que você aguardava):");
   expect(lines.filter(l => l.startsWith("• "))).toHaveLength(19);
   expect(lines).toContain("…e mais 114.");
   expect(lines.at(-1)).toBe('Se não era isso, responda "desfaz".');
   expect(lines.length).toBeLessThanOrEqual(22);
   expect(done.reply).not.toContain("próximo pedido");
   expect(await openProposal(user, now)).toBeNull();
   const statuses = (await admin.query("SELECT id,status FROM tarefas WHERE user_id=$1", [user])).rows as { id: string; status: string }[];
   for (const id of expected) expect(statuses.find(s => s.id === id)?.status).toBe("concluida");
   expect(statuses.find(s => s.id === ids.comPrazo)?.status).toBe("aberta");
   expect((await row(ids.outraConta)).status).toBe("aberta");
   expect((await admin.query("SELECT count(DISTINCT batch_id)::int AS batches,count(*)::int AS n FROM coach_task_changes WHERE user_id=$1", [user])).rows[0]).toEqual({ batches: 1, n: 133 });

   const undo = await handleTaskMessage(user, "desfaz", [], SP, now) as { reply: string };
   expect(undo.reply.split("\n")[0]).toBe("Voltei 133 tarefas como estavam:");
   expect((await admin.query("SELECT count(*)::int AS n FROM tarefas WHERE user_id=$1 AND status='aberta' AND prazo IS NULL", [user])).rows[0].n).toBe(133);
  }, 60000);
  test("se uma mudança do lote falha, nenhuma é feita e a pergunta continua valendo", async () => {
   const [first, second] = (await admin.query("SELECT id FROM tarefas WHERE user_id=$1 AND status='aberta' AND prazo IS NULL ORDER BY titulo LIMIT 2", [user])).rows.map(r => r.id as string);
   const actions = [{ type: "complete", tarefa_id: first, quote: "x", due_date: null, owner: null, title: null, priority: null }, { type: "priority", tarefa_id: second, quote: "x", due_date: null, owner: null, title: null, priority: "altissima" }];
   await admin.query("INSERT INTO coach_task_proposals(user_id,actions,summary,expires_at) VALUES($1,$2::jsonb,'Posso?',now()+interval '1 hour')", [user, JSON.stringify(actions)]);
   const answer = await handleTaskMessage(user, "sim", [], SP, new Date(), "run-falha") as { reply: string };
   expect(answer.reply).toBe('Não consegui aplicar agora e nada foi mudado. Responda "sim" de novo para tentar outra vez.');
   expect((await row(first)).status).toBe("aberta");
   expect(await openProposal(user)).not.toBeNull();
   await admin.query("UPDATE coach_task_proposals SET resolved_at=now(),resolution='declined' WHERE user_id=$1", [user]);
  });
  test("pedir já é a permissão: 'Já pode fazer…' e o pedido simples fazem na hora; só 'me mostra antes' (palavras e intérprete juntos) pergunta", async () => {
   const openNoDue = async () => (await admin.query("SELECT count(*)::int AS n FROM tarefas WHERE user_id=$1 AND status='aberta' AND prazo IS NULL", [user])).rows[0].n;
   const simples = "Pode concluir TODAS sem prazo";
   // The model alone cannot turn a request into a question: the message must ask to see first.
   interpreter(reply({ bulk: [bulk({ due: "none", quote: simples })], ask_first: true }));
   const feitoSimples = await handleTaskMessage(user, simples, [], SP, now, "run-simples") as { reply: string };
   expect(feitoSimples.reply.split("\n")[0]).toBe("Concluí 133 tarefas sem prazo (130 suas, 2 para você cobrar e 1 que você aguardava):");
   expect(await openNoDue()).toBe(0);
   await handleTaskMessage(user, "desfaz", [], SP, now);
   expect(await openNoDue()).toBe(133);

   const message = "TODAS sem prazo DEVEM ser concluidas. Já pode fazer e depois me fala só as que ficaram abertas";
   interpreter(reply({ bulk: [bulk({ due: "none", quote: message }), bulk({ type: "list", all: true, quote: message })], also_reply: true }));
   const feito = await handleTaskMessage(user, message, [], SP, now, "run-permissao") as TaskNotes;
   expect(feito.waiting).toEqual([]);
   expect(feito.done[0]).toBe("Concluí 133 tarefas sem prazo (130 suas, 2 para você cobrar e 1 que você aguardava):");
   expect(feito.done.at(-1)).toBe('Se não era isso, responda "desfaz".');
   expect(feito.listings).toHaveLength(1);
   expect(await openNoDue()).toBe(0);
   expect(await openProposal(user, now)).toBeNull();
   await handleTaskMessage(user, "desfaz", [], SP, now);
   expect(await openNoDue()).toBe(133);

   // Words without the interpreter (negation) do not ask either.
   const negacao = "Pode concluir todas sem prazo, não precisa me perguntar antes";
   interpreter(reply({ bulk: [bulk({ due: "none", quote: negacao })] }));
   expect((await handleTaskMessage(user, negacao, [], SP, now, "run-negacao") as { reply: string }).reply).not.toContain("Posso fazer?");
   await handleTaskMessage(user, "desfaz", [], SP, now);

   const antes = "Conclui todas sem prazo, mas me mostra antes";
   interpreter(reply({ bulk: [bulk({ due: "none", quote: antes })], ask_first: true }));
   const pergunta = await handleTaskMessage(user, antes, [], SP, now, "run-antes") as { reply: string };
   expect(pergunta.reply.split("\n")[0]).toBe("Vou concluir 133 tarefas sem prazo. São 130 suas, 2 para você cobrar e 1 que você está aguardando. Posso fazer?");
   expect(await openNoDue()).toBe(133);
   await admin.query("UPDATE coach_task_proposals SET resolved_at=now(),resolution='declined' WHERE user_id=$1 AND resolved_at IS NULL", [user]);
  }, 60000);
  test("'sim' a uma pergunta do Coach sem proposta guardada volta para o intérprete com a conversa e faz", async () => {
   const history = [{ role: "user", content: "Pode concluir TODAS sem prazo" }, { role: "assistant", content: "Quer concluir todas as tarefas abertas sem prazo, de qualquer responsável?" }];
   interpreter(reply({ bulk: [bulk({ due: "none", quote: "sim" })] }));
   const done = await handleTaskMessage(user, "sim", history, SP, now, "run-sim-solto") as { reply: string };
   expect(done.reply.split("\n")[0]).toBe("Concluí 133 tarefas sem prazo (130 suas, 2 para você cobrar e 1 que você aguardava):");
   expect((sent.at(-1)!.data.recent_conversation as unknown[]).length).toBe(2);
   await handleTaskMessage(user, "desfaz", [], SP, now);
  }, 60000);
 });

 describe("cada jeito de escolher e cada mudança em lote", () => {
  const user = randomUUID();
  const t: Record<string, string> = {};
  const now = new Date("2026-09-28T15:00:00Z"); // segunda, 12h em São Paulo
  let ctx: Awaited<ReturnType<typeof filterContext>>;
  const titles = async (f: Partial<TaskFilter>) => (await selectTasks(user, filter(f), { timezone: SP, now })).tasks.map(x => x.titulo).sort();
  beforeAll(async () => {
   await admin.query("INSERT INTO users(id) VALUES($1)", [user]);
   const mkt = (await admin.query("INSERT INTO frentes(user_id,nome) VALUES($1,'Marketing') RETURNING id", [user])).rows[0].id;
   await admin.query("INSERT INTO pessoas(user_id,nome,aliases) VALUES($1,'Tiago','{Ti,Thiago}'),($1,'Vitor','{Vitão}')", [user]);
   await admin.query("UPDATE pessoas SET is_vitor=true WHERE user_id=$1 AND nome='Vitor'", [user]);
   const meeting = (await admin.query("INSERT INTO meetings(user_id,nome,recorded_at) VALUES($1,'Reunião com a Paula','2026-09-25T13:00:00Z') RETURNING id", [user])).rows[0].id;
   const board = (await admin.query("INSERT INTO quadros(user_id,nome) VALUES($1,'WW - MKT & Vendas') RETURNING id", [user])).rows[0].id;
   t.atrasada = await insert(user, "Atrasada minha", { prazo: "2026-09-22T15:00:00Z", prioridade: "alta" });
   t.hoje = await insert(user, "Vence hoje", { prazo: "2026-09-28T15:00:00Z", prioridade: "urgente" });
   t.futura = await insert(user, "Futura do site", { prazo: "2026-10-05T15:00:00Z" });
   t.tiago = await insert(user, "Cobrar Tiago do organograma", { owner: "Tiago", is_mine: false, acao: "cobrar" });
   t.thiago = await insert(user, "Thiago manda proposta", { owner: "Thiago", is_mine: false, acao: "cobrar", prazo: "2026-09-26T15:00:00Z" });
   t.grupo = await insert(user, "Tiago e Vitor alinham metas", { owner: "Tiago e Vitor", is_mine: false, acao: "cobrar" });
   t.binho = await insert(user, "Binho sobe anúncios", { owner: "Binho", is_mine: false, acao: "aguardar", meeting_id: meeting });
   t.ninguem = await insert(user, "Alguém revisa o site", { owner: "?", is_mine: false, acao: "cobrar", frente_id: mkt });
   t.proposta = await insert(user, "Campanha TikTok", { frente_proposta: "Marketing", prioridade: "baixa" });
   t.parada = await insert(user, "Parada faz tempo", { created_at: "2026-07-10T15:00:00Z", updated_at: "2026-07-10T15:00:00Z" });
   t.repetida = await insert(user, "Parece repetida", { parece_com_id: t.parada });
   t.concluidaHoje = await insert(user, "Concluída hoje", { status: "concluida" });
   await admin.query("UPDATE tarefas SET concluida_em='2026-09-28T13:00:00Z' WHERE id=$1", [t.concluidaHoje]);
   t.concluidaAntes = await insert(user, "Concluída antes", { status: "concluida" });
   await admin.query("UPDATE tarefas SET concluida_em='2026-09-20T13:00:00Z' WHERE id=$1", [t.concluidaAntes]);
   await admin.query("INSERT INTO quadro_tarefas(quadro_id,tarefa_id) VALUES($1,$2),($1,$3)", [board, t.tiago, t.proposta]);
   ctx = await filterContext(user, "as da reunião com a Paula");
  });
  test("o contexto do intérprete traz os quadros, as áreas usadas e, quando fala de reunião, as reuniões", async () => {
   expect(ctx.boards.map(x => x.nome)).toEqual(["WW - MKT & Vendas"]);
   expect(ctx.areas.map(x => x.nome)).toEqual(["Marketing"]);
   expect(ctx.meetings.map(x => x.titulo)).toEqual(["Reunião com a Paula"]);
   expect((await filterContext(user, "conclui as atrasadas")).meetings).toEqual([]);
  });
  test("prazo: sem prazo, com prazo, atrasadas, hoje, até hoje", async () => {
   expect(await titles({ due: "none" })).toEqual(["Alguém revisa o site", "Binho sobe anúncios", "Campanha TikTok", "Cobrar Tiago do organograma", "Parada faz tempo", "Parece repetida", "Tiago e Vitor alinham metas"]);
   expect(await titles({ due: "any" })).toEqual(["Atrasada minha", "Futura do site", "Thiago manda proposta", "Vence hoje"]);
   expect(await titles({ due: "range", due_until: "2026-09-27" })).toEqual(["Atrasada minha", "Thiago manda proposta"]);
   expect(await titles({ due: "range", due_from: "2026-09-28", due_until: "2026-09-28" })).toEqual(["Vence hoje"]);
   expect(await titles({ due: "range", due_until: "2026-09-28" })).toEqual(["Atrasada minha", "Thiago manda proposta", "Vence hoje"]);
  });
  test("de quem: suas, dos outros, sem responsável, por nome com apelido do cadastro, grupo não é seu", async () => {
   expect(await titles({ who: "me" })).toEqual(["Atrasada minha", "Campanha TikTok", "Futura do site", "Parada faz tempo", "Parece repetida", "Vence hoje"]);
   expect(await titles({ who: "nobody" })).toEqual(["Alguém revisa o site"]);
   expect(await titles({ people: ["Tiago"] })).toEqual(["Cobrar Tiago do organograma", "Thiago manda proposta", "Tiago e Vitor alinham metas"]);
   expect(await titles({ people: ["Vitão"] })).toEqual(await titles({ who: "me" }));
   expect(await titles({ all: true, not_people: ["Tiago"] })).not.toContain("Thiago manda proposta");
   expect(await titles({ kind: "wait" })).toEqual(["Binho sobe anúncios"]);
   expect(await titles({ kind: "chase" })).toEqual(["Alguém revisa o site", "Cobrar Tiago do organograma", "Thiago manda proposta", "Tiago e Vitor alinham metas"]);
  });
  test("prioridade, quadro, área (aprovada ou proposta), reunião, assunto, paradas, repetidas, criadas, concluídas", async () => {
   expect(await titles({ priorities: ["urgente", "alta"] })).toEqual(["Atrasada minha", "Vence hoje"]);
   expect(await titles({ boards: [ctx.boards[0].id] })).toEqual(["Campanha TikTok", "Cobrar Tiago do organograma"]);
   expect(await titles({ all: true, not_boards: [ctx.boards[0].id] })).not.toContain("Campanha TikTok");
   expect(await titles({ areas: ["Marketing"] })).toEqual(["Alguém revisa o site", "Campanha TikTok"]);
   expect(await titles({ areas: ["sem_area"] })).not.toContain("Campanha TikTok");
   expect(await titles({ meetings: [ctx.meetings[0].id] })).toEqual(["Binho sobe anúncios"]);
   expect(await titles({ meeting_from: "2026-09-25", meeting_until: "2026-09-25" })).toEqual(["Binho sobe anúncios"]);
   expect(await titles({ source: "manual" })).not.toContain("Binho sobe anúncios");
   expect(await titles({ words: ["site"] })).toEqual(["Alguém revisa o site", "Futura do site"]);
   expect(await titles({ words: ["site"], not_words: ["revisa"] })).toEqual(["Futura do site"]);
   expect(await titles({ idle_days: 30 })).toEqual(["Parada faz tempo"]);
   expect(await titles({ repeated: true })).toEqual(["Parece repetida"]);
   expect(await titles({ created_until: "2026-07-31" })).toEqual(["Parada faz tempo"]);
   expect(await titles({ status: "done", closed_from: "2026-09-28", closed_until: "2026-09-28" })).toEqual(["Concluída hoje"]);
   expect(await titles({ status: "closed" })).toEqual(["Concluída antes", "Concluída hoje"]);
  });
  test("contagem por prazo e por tipo cobre todas, mesmo quando a lista volta cortada", async () => {
   const s = await selectTasks(user, filter({ all: true }), { timezone: SP, now, limit: 3 });
   expect(s.tasks).toHaveLength(3);
   expect(s.total).toBe(11);
   expect(s.counts).toMatchObject({ atrasadas: 2, hoje: 1, depois: 1, sem_prazo: 7, suas: 6, cobrar: 4, aguardando: 1 });
   // "Thiago" is how one meeting wrote the registry's Tiago: counted under Tiago.
   expect(s.counts.por_pessoa).toEqual({ "você": 6, Tiago: 2, "a definir": 1, Binho: 1, "Tiago e Vitor": 1 });
  });
  test("adiar em dias: atrasada conta de hoje, futura do próprio prazo, sem prazo fica e é dita", async () => {
   const message = "adia as minhas uma semana";
   interpreter(reply({ bulk: [bulk({ type: "shift", days: 7, who: "me", quote: message })] }));
   // Three of the user's own tasks: changed at once, with what stayed out said plainly.
   const answer = await handleTaskMessage(user, message, [], SP, now, "run-shift") as { reply: string };
   expect(answer.reply).toBe('Novo prazo de "Atrasada minha": seg, 05/10.\nNovo prazo de "Vence hoje": seg, 05/10.\nNovo prazo de "Futura do site": seg, 12/10.\nOutras 3 estão sem prazo e ficam como estão.\nSe não era isso, responda "desfaz".');
   expect((await row(t.atrasada)).prazo.toISOString()).toBe("2026-10-05T15:00:00.000Z");
   expect((await row(t.hoje)).prazo.toISOString()).toBe("2026-10-05T15:00:00.000Z");
   expect((await row(t.futura)).prazo.toISOString()).toBe("2026-10-12T15:00:00.000Z");
   await handleTaskMessage(user, "desfaz", [], SP, now);
   expect((await row(t.atrasada)).prazo.toISOString()).toBe("2026-09-22T15:00:00.000Z");
  });
  test("tirar o prazo, passar para alguém que você só aguarda e mudar a prioridade, em lote, na hora e com 'desfaz'", async () => {
   const clear = "tira o prazo das atrasadas";
   interpreter(reply({ bulk: [bulk({ type: "clear_due", due: "range", due_until: "2026-09-27", quote: clear })] }));
   // One of them is someone else's: done at once all the same.
   const cleared = await handleTaskMessage(user, clear, [], SP, now, "run-clear") as { reply: string };
   expect(cleared.reply.split("\n").sort()).toEqual(['Se não era isso, responda "desfaz".', 'Tirei o prazo de "Atrasada minha".', 'Tirei o prazo de "Thiago manda proposta".']);
   expect((await row(t.atrasada)).prazo).toBeNull();
   await handleTaskMessage(user, "desfaz", [], SP, now);
   expect((await row(t.atrasada)).prazo.toISOString()).toBe("2026-09-22T15:00:00.000Z");

   const pass = "passa as do Tiago para a Diana, só vou aguardar";
   interpreter(reply({ bulk: [bulk({ type: "reassign", owner: "Diana", wait: true, people: ["Tiago"], quote: pass })] }));
   const passDone = await handleTaskMessage(user, pass, [], SP, now, "run-pass") as { reply: string };
   // Three tasks read one by one; more than three read as one line and the titles.
   expect(passDone.reply.split("\n").filter(l => l.endsWith("agora é com Diana (você só aguarda)."))).toHaveLength(3);
   expect(await row(t.tiago)).toMatchObject({ owner: "Diana", acao: "aguardar" });
   await handleTaskMessage(user, "desfaz", [], SP, now);
   expect(await row(t.tiago)).toMatchObject({ owner: "Tiago", acao: "cobrar" });

   const prio = "marca como urgente as do quadro WW";
   interpreter(reply({ bulk: [bulk({ type: "priority", priority: "urgente", boards: ["q1"], quote: prio })] }));
   // Two tasks on a board, one of them someone else's: done at once.
   const prioDone = await handleTaskMessage(user, prio, [], SP, now, "run-prio") as { reply: string };
   expect(prioDone.reply).toContain('Prioridade de "Campanha TikTok": urgente.');
   expect(prioDone.reply).toContain('Prioridade de "Cobrar Tiago do organograma": urgente.');
   expect((await row(t.proposta)).prioridade).toBe("urgente");
  });
  test("reabrir as que foram concluídas hoje; pedido que não acha nada diz o critério", async () => {
   const message = "reabre as que concluí hoje";
   interpreter(reply({ bulk: [bulk({ type: "reopen", status: "done", closed_from: "2026-09-28", closed_until: "2026-09-28", quote: message })] }));
   const answer = await handleTaskMessage(user, message, [], SP, now, "run-reopen") as { reply: string };
   expect(answer.reply).toBe('Reabri "Concluída hoje".\nSe não era isso, responda "desfaz".');
   expect((await row(t.concluidaAntes)).status).toBe("concluida");
   const none = "conclui as do Pedro";
   interpreter(reply({ bulk: [bulk({ people: ["Pedro"], quote: none })] }));
   expect(await handleTaskMessage(user, none, [], SP, now, "run-none")).toEqual({ reply: "Não achei tarefa aberta de Pedro." });
  });
  test("pedido de ver ou contar vira lista com o mesmo total que a mudança usaria; a lista das 8h sai para não somar diferente", async () => {
   const message = "quais estão sem prazo?";
   interpreter(reply({ intent: "none", bulk: [bulk({ type: "list", due: "none", quote: message })] }));
   const notes = await handleTaskMessage(user, message, [], SP, now, "run-list") as TaskNotes;
   expect(notes).toMatchObject({ done: [], waiting: [], lane: "tarefas" });
   expect(notes.listings).toHaveLength(1);
   const dossier = await runQueries(user, [{ tipo: "pendencias", pessoa: null, reuniao: null, busca: "", periodo: null, campo: "prazo", status: "abertas", ordem: "prazo" }], { timezone: SP, now, selfPersonIds: [], people: [], listings: notes.listings });
   const listing = dossier.consultas.find(c => c.tipo === "tarefas_filtradas")!;
   const change = await expandBulk(user, { ...notes.listings![0], type: "complete" }, SP, now);
   expect(listing.total).toBe(change.actions.length);
   // "Concluída hoje" was reopened by the test before: 8 without a deadline now.
   expect(listing.contagem).toMatchObject({ sem_prazo: 8, suas: 4, para_cobrar: 3, aguardando: 1 });
   expect(listing.total).toBe(8);
   expect(listing.tarefas!.find(x => x.titulo === "Binho sobe anúncios")).toMatchObject({ owner: "Binho", modo: "aguardar", reuniao: { titulo: "Reunião com a Paula" } });
   interpreter({ consultas: [{ tipo: "pendencias", pessoa: "", reuniao: "", busca: "", periodo: "", campo: "prazo", status: "abertas", ordem: "prazo" }] });
   const built = await buildDossier({ userId: user, message, recent: [], lane: "tarefas", timezone: SP, now, selfPersonIds: [], listings: notes.listings });
   expect(built.consultas.map(c => c.tipo)).toEqual(["tarefas_filtradas"]);
  });
  test("o que o Coach não faz é dito na hora, com o caminho no app", async () => {
   const message = "coloca as do Tiago no quadro Marketing";
   interpreter(reply({ intent: "none", unsupported: "colocar tarefas no quadro Marketing" }));
   const answer = await handleTaskMessage(user, message, [], SP, now, "run-unsupported") as { reply: string };
   expect(answer.reply).toMatch(/^Isso eu ainda não faço por aqui: colocar tarefas no quadro Marketing\. No Ações dá para fazer direto: https?:\/\//);
  });
  test("o servidor recusa lote de mudança sem critério e nunca troca um código desconhecido por 'todas'", () => {
   const tasks = new Map<string, CandidateTask>();
   expect(validateBulk([bulk({ quote: "conclui" })], "conclui", tasks, SP, now, ctx)).toEqual([]);
   expect(validateBulk([bulk({ boards: ["q7"], quote: "conclui" })], "conclui", tasks, SP, now, ctx)).toEqual([]);
  });
  test("pedido misto de 28/09 (atrasadas + as citadas + passar as de mkt): tudo na hora, numa mudança só; 'desfaz e …' volta tudo e faz o resto", async () => {
   const message = "Pode marcar todas as atrasadas como concluidas. E essa abaixo tmb: Futura do site. Todas as de mkt são da Paula";
   interpreter(data => {
    const code = (data.tasks as { task: string; title: string }[]).find(x => x.title === "Futura do site")!.task;
    return reply({
     actions: [{ type: "complete", task: code, quote: message, due_date: "", owner: "", title: "", priority: "", check: false, wait: false }],
     bulk: [bulk({ due: "range", due_until: "2026-09-27", quote: message }), bulk({ type: "reassign", owner: "Paula", areas: ["a1"], quote: message })],
    });
   });
   const answer = await handleTaskMessage(user, message, [], SP, now, "run-misto") as { reply: string };
   expect(answer.reply).not.toContain("Posso fazer?");
   expect(answer.reply.split("\n").at(-1)).toBe('Se não era isso, responda "desfaz".');
   for (const id of [t.atrasada, t.thiago, t.futura]) expect((await row(id)).status).toBe("concluida");
   for (const id of [t.ninguem, t.proposta]) expect((await row(id)).owner).toBe("Paula");
   expect((await admin.query("SELECT count(DISTINCT batch_id)::int AS batches,count(*)::int AS n FROM coach_task_changes WHERE user_id=$1 AND run_key LIKE 'run-misto:%'", [user])).rows[0]).toEqual({ batches: 1, n: 5 });

   const again = "Desfaz e conclui só a Futura do site";
   interpreter(data => {
    const code = (data.tasks as { task: string; title: string }[]).find(x => x.title === "Futura do site")!.task;
    return reply({ actions: [{ type: "complete", task: code, quote: String(data.message), due_date: "", owner: "", title: "", priority: "", check: false, wait: false }] });
   });
   const redo = await handleTaskMessage(user, again, [], SP, now, "run-desfaz-e") as { reply: string };
   expect(sent.at(-1)!.message).toBe("conclui só a Futura do site");
   expect(redo.reply).toContain('Concluí "Futura do site".');
   expect(redo.reply.split("\n").at(-1)).toBe('Se não era isso, responda "desfaz".');
   for (const id of [t.atrasada, t.thiago]) expect((await row(id)).status).toBe("aberta");
   expect((await row(t.futura)).status).toBe("concluida");
   expect((await row(t.ninguem)).owner).toBe("?");
   expect((await row(t.proposta)).owner).toBe("vitor");
   await handleTaskMessage(user, "desfaz", [], SP, now);
   expect((await row(t.futura)).status).toBe("aberta");
  });
 });
});

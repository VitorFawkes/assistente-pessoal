import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

// Coach no Ações da equipe, no banco real: todas as migrations (db/00*.sql + db/equipe/*.sql) aplicadas num banco
// modelo local (COACH_EQUIPE_TEST_DATABASE_URL aponta para ele, ex. postgresql://postgres@localhost:55433/equipe_base).
// Cada rodada copia o modelo num banco novo e apaga no fim. Nunca roda fora de localhost.
const base = process.env.COACH_EQUIPE_TEST_DATABASE_URL;
const SP = "America/Sao_Paulo";

describe.skipIf(!base)("Coach dentro do TTARS: só o Vitor, com as regras de tarefa do TTARS", () => {
 const vitor = randomUUID(), tiago = randomUUID();
 const own = randomUUID(), fabi = randomUUID(), passada = randomUUID(), soDoTiago = randomUUID();
 const dbName = `coach_eq_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
 let admin: Pool, root: Pool;
 const env = { ...process.env };
 // Prazo hoje às 23:59 de Brasília, como o TTARS grava.
 const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: SP, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
 const fimDeHoje = () => new Date(`${hoje()}T23:59:00-03:00`).toISOString();
 const row = (id: string) => admin.query("SELECT titulo,owner,acao,status,prazo,responsavel_user_id FROM tarefas WHERE id=$1", [id]).then(r => r.rows[0]);
 let mod: {
  so: typeof import("./so-um"); store: typeof import("./store"); channel: typeof import("../whatsapp/channel"); filter: typeof import("./task-filter");
  actions: typeof import("./task-actions"); agenda: typeof import("./morning-agenda"); commitments: typeof import("./coach-commitments"); mudar: typeof import("../tarefa-mudar");
 };

 beforeAll(async () => {
  const url = new URL(base!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Só banco local");
  root = new Pool({ connectionString: base, max: 1 });
  await root.query(`CREATE DATABASE ${dbName} TEMPLATE ${url.pathname.slice(1)}`);
  const own_url = new URL(base!); own_url.pathname = `/${dbName}`;
  admin = new Pool({ connectionString: own_url.toString(), max: 1 });
  await admin.query(`INSERT INTO users(id,nome,email,is_admin,consent_terms_at) VALUES
   ($1,'Vitor Gambetti','vitor@welcometrips.com.br',true,now()),($2,'Tiago de Mello Abdul Hak','tiago@welcometrips.com.br',false,now())`, [vitor, tiago]);
  await admin.query("INSERT INTO acessos_equipe(email,liberado) VALUES('vitor@welcometrips.com.br',true),('tiago@welcometrips.com.br',true)");
  await admin.query(`INSERT INTO ttars_pessoas(email,nome,organizacao,times) VALUES
   ('vitor@welcometrips.com.br','Vitor Gambetti','Welcome Trips','[]'),('tiago@welcometrips.com.br','Tiago de Mello Abdul Hak','Welcome Trips','[]'),
   ('paula@welcometrips.com.br','Paula Klotz','Welcome Trips','[]')`);
  await admin.query("INSERT INTO coach_profiles(user_id,enabled,timezone) VALUES($1,true,$3),($2,true,$3)", [vitor, tiago, SP]);
  await admin.query(`INSERT INTO tarefas(id,user_id,titulo,owner,acao,prazo) VALUES
   ($1,$5,'Enviar proposta da closer','eu','executar',$7),($2,$5,'Contrato do fornecedor','Fabi','cobrar',null),
   ($3,$6,'Revisar planilha de custos','Tiago de Mello Abdul Hak','cobrar',$7),($4,$6,'Tarefa só do Tiago','eu','executar',null)`,
   [own, fabi, passada, soDoTiago, vitor, tiago, fimDeHoje()]);
  // Tiago passou a planilha para o Vitor: é do Tiago (user_id) e cai na lista do Vitor.
  await admin.query("UPDATE tarefas SET responsavel_user_id=$2, owner='Vitor Gambetti' WHERE id=$1", [passada, vitor]);
  await global.__pgPool?.end(); global.__pgPool = undefined;
  const tenant = new URL(own_url.toString()); tenant.username = "app_tenant"; tenant.password = "";
  Object.assign(process.env, {
   DATABASE_URL: tenant.toString(), TEAM_MODE: "1", OWNER_SLUG: "eu", COACH_SO_USER_ID: vitor,
   WHATSAPP_WEBHOOK_SECRET: randomUUID() + randomUUID(), EVOLUTION_COACH_INSTANCE: "coach",
  });
  mod = {
   so: await import("./so-um"), store: await import("./store"), channel: await import("../whatsapp/channel"), filter: await import("./task-filter"),
   actions: await import("./task-actions"), agenda: await import("./morning-agenda"), commitments: await import("./coach-commitments"), mudar: await import("../tarefa-mudar"),
  };
 });
 afterAll(async () => {
  process.env = env;
  await global.__pgPool?.end(); global.__pgPool = undefined;
  await admin?.end();
  await root?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await root?.end();
 });

 test("só a conta do Vitor tem Coach: lista de quem roda, vínculo do WhatsApp", async () => {
  expect(mod.so.coachPermitido(vitor)).toBe(true);
  expect(mod.so.coachPermitido(tiago)).toBe(false);
  expect(await mod.store.enabledUserIds()).toEqual([vitor]);
  await expect(mod.channel.startLink(tiago)).rejects.toThrow("whatsapp_not_allowed");
  expect(await mod.channel.startLink(vitor)).toMatch(/^\d{6}$/);
  const semConta = process.env.COACH_SO_USER_ID; delete process.env.COACH_SO_USER_ID;
  expect(mod.so.coachPermitido(vitor)).toBe(false);
  process.env.COACH_SO_USER_ID = semConta;
 });

 test("WhatsApp ligado a outra conta fica sem resposta e sem nada guardado", async () => {
  await admin.query("INSERT INTO whatsapp_links(user_id,phone,verified_at) VALUES($1,'5511911112222',now())", [tiago]);
  const r = await mod.channel.handleEvent({ event: "messages.upsert", instance: "coach", data: { key: { remoteJid: "5511911112222@s.whatsapp.net", fromMe: false, id: "M1" }, message: { conversation: "oi Coach" } } });
  expect(r).toBeNull();
  expect((await admin.query("SELECT count(*)::int n FROM whatsapp_messages WHERE user_id=$1", [tiago])).rows[0].n).toBe(0);
 });

 test("pedido em lote enxerga a tarefa que o Tiago passou e não a que é só dele", async () => {
  const sel = await mod.filter.selectTasks(vitor, mod.filter.emptyFilter(), { timezone: SP, now: new Date() });
  const titulos = sel.tasks.map(t => t.titulo);
  expect(titulos).toContain("Revisar planilha de custos");
  expect(titulos).not.toContain("Tarefa só do Tiago");
  expect(sel.tasks.find(t => t.id === passada)).toMatchObject({ mine: true, shared: true });
  expect(sel.counts.suas).toBe(2);
 });

 test("concluir a sua e a que o Tiago passou: muda pela regra do TTARS, no histórico como Coach, e 'desfaz' volta", async () => {
  const tasks = new Map((await mod.actions.candidateTasks(vitor, "")).map(t => [t.id, t]));
  expect(tasks.has(passada)).toBe(true);
  const lines = await mod.actions.applyTaskActions(vitor, [
   { type: "complete", tarefa_id: own, quote: "conclui", due_date: null, owner: null, title: null, priority: null },
   { type: "complete", tarefa_id: passada, quote: "conclui", due_date: null, owner: null, title: null, priority: null },
  ], tasks, SP, "run-concluir");
  expect(lines.join("\n")).toContain("Revisar planilha de custos");
  expect((await row(own)).status).toBe("concluida");
  expect((await row(passada)).status).toBe("concluida");
  const ev = (await admin.query("SELECT ator_user_id,payload->>'origem' origem FROM tarefa_eventos WHERE tarefa_id=$1 AND evento='concluida'", [passada])).rows[0];
  expect(ev).toEqual({ ator_user_id: vitor, origem: "coach" });
  expect((await admin.query("SELECT count(*)::int n FROM coach_task_changes WHERE user_id=$1", [vitor])).rows[0].n).toBe(2);
  const volta = await mod.actions.undoLastBatch(vitor);
  expect(volta.join("\n")).toContain("voltou como estava");
  expect((await row(own)).status).toBe("aberta");
  expect((await row(passada)).status).toBe("aberta");
  expect((await row(passada)).responsavel_user_id).toBe(vitor);
 });

 test("passar para o Tiago entrega na lista dele (como a tela do TTARS)", async () => {
  const tasks = new Map((await mod.actions.candidateTasks(vitor, "")).map(t => [t.id, t]));
  await mod.actions.applyTaskActions(vitor, [{ type: "reassign", tarefa_id: fabi, quote: "passa", due_date: null, owner: "Tiago", title: null, priority: null }], tasks, SP, "run-passar");
  expect(await row(fabi)).toMatchObject({ owner: "Tiago de Mello Abdul Hak", acao: "cobrar", responsavel_user_id: tiago });
  const paraTiago = await admin.query("SELECT set_config('app.current_user_id',$1,false)", [tiago]).then(() => admin.query("SELECT tarefa_id::text FROM equipe_tarefas_para_mim()"));
  expect(paraTiago.rows.map(r => r.tarefa_id)).toContain(fabi);
 });

 test("criar pelo Coach: sua, de colega da Welcome e de alguém de fora", async () => {
  const run = (a: Record<string, unknown>, key: string) => mod.actions.applyTaskActions(vitor, [{ type: "create", tarefa_id: null, quote: "cria", due_date: null, owner: null, title: null, priority: null, ...a } as never], new Map(), SP, key);
  await run({ title: "Revisar a apresentação", due_date: hoje() }, "c1");
  await run({ title: "Mandar o briefing", owner: "Tiago" }, "c2");
  await run({ title: "Ligar para o Pedro", owner: "Pedro" }, "c3");
  const by = async (t: string) => (await admin.query("SELECT id,owner,acao,responsavel_user_id,prazo FROM tarefas WHERE titulo=$1", [t])).rows[0];
  const minha = await by("Revisar a apresentação");
  expect(minha).toMatchObject({ owner: "eu", acao: "executar", responsavel_user_id: null });
  expect(new Date(minha.prazo).toISOString()).toBe(fimDeHoje());
  expect(await by("Mandar o briefing")).toMatchObject({ owner: "Tiago de Mello Abdul Hak", acao: "cobrar", responsavel_user_id: tiago });
  expect(await by("Ligar para o Pedro")).toMatchObject({ owner: "Pedro", acao: "cobrar", responsavel_user_id: null });
  const criada = (await admin.query("SELECT payload->>'origem' origem FROM tarefa_eventos WHERE tarefa_id=$1 AND evento='criada'", [minha.id])).rows[0];
  expect(criada.origem).toBe("coach");
 });

 test("lista das 8h traz a que o Tiago passou, junto com as suas", async () => {
  const texto = await mod.agenda.morningAgenda(vitor, SP);
  expect(texto).toContain("Revisar planilha de custos");
  expect(texto).toContain("Enviar proposta da closer");
  const due = await mod.agenda.dueTasks(vitor, SP);
  expect(due.items.map(i => i.titulo)).toContain("Revisar planilha de custos");
 });

 test("combinado delegado ao Tiago vira tarefa na lista dele", async () => {
  const msg = (await admin.query("INSERT INTO coach_messages(user_id,role,content) VALUES($1,'user','Combinei com o Tiago de enviar o relatório') RETURNING id", [vitor])).rows[0].id;
  const r = await mod.commitments.createCommitment(vitor, { accepted: true, idempotency_key: "combinado-tiago-1", source_message_id: msg, title: "Enviar o relatório", action: "cobrar", owner: "Tiago" });
  const t = await row(r.tarefa_id!);
  expect(t).toMatchObject({ owner: "Tiago de Mello Abdul Hak", acao: "cobrar", responsavel_user_id: tiago });
 });

 test("a regra da tela vale para todos: quem não enxerga a tarefa não muda", async () => {
  const r = await mod.mudar.mudarTarefa({ id: tiago }, own, { status: "concluida" });
  expect(r.status).toBe(404);
  const ok = await mod.mudar.mudarTarefa({ id: vitor }, own, { status: "em_andamento" });
  expect(ok.status).toBe(200);
  expect((await row(own)).status).toBe("em_andamento");
 });
});

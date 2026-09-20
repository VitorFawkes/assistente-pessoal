import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { sourceHash } from "./evidence";
import { coachStore, enabledUserIds, StaleCoachRunError } from "./store";
import { getPool, withTenant } from "../db";
import type { CoachMeeting, Evidence, Observation, ReviewContent } from "./types";

// Intentionally opt-in: never applies fixtures to the normal DATABASE_URL.
// COACH_TEST_DATABASE_URL=postgresql://<owner>@localhost:55432/coach_test bun test lib/coach/store.integration.test.ts
const connection = process.env.COACH_TEST_DATABASE_URL;
describe.skipIf(!connection)("coach store: real Postgres isolation and lifecycle", () => {
  let admin: Pool;
  const userA = randomUUID();
  const userB = randomUUID();
  const meetingA = randomUUID();
  const meetingB = randomUUID();
  const archived = randomUUID();
  const oldMeeting = randomUUID();
  const a = coachStore(userA);
  const b = coachStore(userB);
  const review: ReviewContent = { headline: "Foco", focus: "Priorizar", observations: [], progress: "Sem comparação", experiment: "Escolher uma frente", question: "Qual?", limitations: [] };
  let source: CoachMeeting;

  beforeAll(async () => {
    const url = new URL(connection!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("coach_test"))
      throw new Error("Integration fixture requires a local dedicated coach_test database.");
    admin = new Pool({ connectionString: connection });
    await admin.query(`
      CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY, nome text, deleted_at timestamptz, consent_terms_at timestamptz);
      CREATE TABLE IF NOT EXISTS meetings (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        nome text, original_filename text NOT NULL, recorded_at timestamptz, transcription text, segments jsonb,
        speaker_labels jsonb, speaker_pessoas jsonb, status text, summary text, created_at timestamptz DEFAULT now());
      CREATE TABLE IF NOT EXISTS tarefas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        titulo text, descricao text, owner text, status text, prioridade text, prazo timestamptz, meeting_id uuid,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS is_mine boolean DEFAULT false;
      ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS acao text DEFAULT 'executar';
      ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS concluida_em timestamptz;
      ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS cancelada_em timestamptz;
      ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS frente_id uuid;
      CREATE TABLE IF NOT EXISTS frentes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,nome text);
      CREATE TABLE IF NOT EXISTS tarefa_eventos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tarefa_id uuid NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
        evento text,payload jsonb,created_at timestamptz DEFAULT now());
      CREATE TABLE IF NOT EXISTS tarefa_frentes (tarefa_id uuid NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
        frente_id uuid NOT NULL REFERENCES frentes(id) ON DELETE CASCADE,principal boolean DEFAULT false,PRIMARY KEY(tarefa_id,frente_id));
      CREATE TABLE IF NOT EXISTS pessoas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, is_vitor boolean);
      ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;
      ALTER TABLE pessoas ENABLE ROW LEVEL SECURITY;
      ALTER TABLE frentes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tarefa_eventos ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tarefa_frentes ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS fixture_tenant ON meetings;
      DROP POLICY IF EXISTS fixture_tenant ON tarefas;
      DROP POLICY IF EXISTS fixture_tenant ON pessoas;
      DROP POLICY IF EXISTS fixture_tenant ON frentes;
      DROP POLICY IF EXISTS fixture_tenant ON tarefa_eventos;
      DROP POLICY IF EXISTS fixture_tenant ON tarefa_frentes;
      CREATE POLICY fixture_tenant ON meetings USING(user_id::text = current_setting('app.current_user_id',true));
      CREATE POLICY fixture_tenant ON tarefas USING(user_id::text = current_setting('app.current_user_id',true));
      CREATE POLICY fixture_tenant ON pessoas USING(user_id::text = current_setting('app.current_user_id',true));
      CREATE POLICY fixture_tenant ON frentes USING(user_id::text = current_setting('app.current_user_id',true));
      CREATE POLICY fixture_tenant ON tarefa_eventos USING(EXISTS(SELECT 1 FROM tarefas WHERE tarefas.id=tarefa_eventos.tarefa_id));
      CREATE POLICY fixture_tenant ON tarefa_frentes USING(EXISTS(SELECT 1 FROM tarefas WHERE tarefas.id=tarefa_frentes.tarefa_id));
      GRANT USAGE ON SCHEMA public TO app_tenant,app_writer;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO app_tenant,app_writer;
    `);
    const migration = await readFile(new URL("../../../db/0028_leadership_coach.sql", import.meta.url), "utf8");
    await admin.query(migration);
    await admin.query(migration); // repeatability is part of the contract
    await admin.query("INSERT INTO users (id,nome,consent_terms_at) VALUES ($1,'Fixture A',now()),($2,'Fixture B',now())", [userA,userB]);
    await admin.query(`INSERT INTO meetings (id,user_id,nome,original_filename,recorded_at,transcription,segments,speaker_labels,speaker_pessoas,status,summary)
      VALUES ($1,$2,'Reunião A','a.mp3','2026-09-18','Vou delegar esta entrega.','[]','{}','{}','done','Definição de responsáveis'),
      ($3,$4,'Segredo B','b.mp3','2026-09-19','Segredo exclusivo do tenant B.','[]','{}','{}','done','Secreto'),
      ($5,$2,'Pai arquivado','pai.mp3','2026-09-18','Duplicado pai.','[]','{}','{}','archived_session','Arquivado'),
      ($6,$2,'Histórica','old.mp3','1999-01-01','A experiência orquídea foi decisiva.','[]','{}','{}','done','Decisão antiga')`,
    [meetingA,userA,meetingB,userB,archived,oldMeeting]);
    await admin.query(`INSERT INTO meetings (id,user_id,original_filename,recorded_at,transcription,status)
      SELECT gen_random_uuid(),$1,'fixture-'||n||'.mp3','2026-08-01'::timestamptz + n * interval '1 minute','Reunião de acompanhamento número '||n,'done'
      FROM generate_series(1,103) n`, [userA]);
    await admin.query(`WITH inserted AS (
      INSERT INTO tarefas(user_id,titulo,owner,is_mine,acao,status,prioridade,concluida_em)
      VALUES($1,'Entrega delegada concluída','Ana',false,'cobrar','concluida','alta',now()),
            ($2,'Tarefa confidencial B','B',true,'executar','aberta','alta',NULL)
      RETURNING id,user_id)
      INSERT INTO tarefa_eventos(tarefa_id,evento,payload)
      SELECT id,'status_alterado',jsonb_build_object('novo_status',CASE WHEN user_id=$1 THEN 'concluida' ELSE 'aberta' END) FROM inserted`,[userA,userB]);
    url.username = "app_tenant"; url.password = "";
    process.env.DATABASE_URL = url.toString();
    source = (await a.meetingById(meetingA))!;
  });

  afterAll(async () => {
    await admin?.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA,userB]]);
    await global.__pgPool?.end(); global.__pgPool = undefined;
    await admin?.end();
  });

  test("new profiles disabled; explicit activation; raw RLS denies cross-user access", async () => {
    const defaults = await a.profile();
    expect(defaults.enabled).toBe(false); expect(defaults.review_day).toBe(5); expect(defaults.review_hour).toBe(17);
    expect(await a.claimLease()).toBeNull();
    await a.saveProfile({enabled:true,weekly_enabled:true});
    await b.saveProfile({enabled:true});
    expect(await enabledUserIds()).toEqual(expect.arrayContaining([userA,userB]));
    const profiles = await withTenant(userA, (db) => db.query("SELECT user_id FROM coach_profiles"));
    expect(profiles.rows).toEqual([{user_id:userA}]);
    expect((await getPool().query("SELECT user_id FROM coach_profiles")).rows).toEqual([]);
    expect(await a.meetingById(meetingB)).toBeNull();
    expect(await a.meetingById(archived)).toBeNull();
    await expect(withTenant(userA, (db) => db.query("INSERT INTO coach_messages(user_id,role,content) VALUES ($1,'user','No')",[userB]))).rejects.toThrow();
  });

  test("leases are atomic and owner token prevents stale release", async () => {
    const [first,second] = await Promise.all([a.claimLease(),coachStore(userA).claimLease()]);
    expect([first,second].filter(Boolean).length).toBe(1);
    const token = first ?? second!;
    await a.releaseLease(undefined,randomUUID());
    expect(await coachStore(userA).claimLease()).toBeNull();
    await a.releaseLease(undefined,token);
    const next = await a.claimLease(); expect(next).not.toBeNull();
    await a.releaseLease(undefined,next!);
  });

  test("chunk and weekly writes idempotent; coverage includes history past 100 meetings", async () => {
    const revision = (await a.profile()).revision;
    const input = {meeting_id:meetingA,source_hash:sourceHash(source),chunk_index:0,chunk_count:2,observations:[],summary:"Escuta e empatia",model:"fixture"};
    const one = await a.saveAnalysis(input,revision);
    expect((await a.saveAnalysis(input,revision)).id).toBe(one.id);
    expect(await a.coverage()).toEqual({total_meetings:105,analyzed_meetings:0,analyzed_chunks:1,pending_meetings:105});
    await a.saveAnalysis({...input,chunk_index:1},revision);
    expect(await a.coverage()).toEqual({total_meetings:105,analyzed_meetings:1,analyzed_chunks:2,pending_meetings:104});
    expect((await a.saveReview("2026-09-14",review,"fixture",revision)).id)
      .toBe((await a.saveReview("2026-09-14",review,"fixture",revision)).id);
    expect((await b.analyses()).length).toBe(0);
    const period = await a.analysesInPeriod("2026-09-14","2026-09-21");
    expect(period.analyses.length).toBe(2); expect(period.meetings[0].id).toBe(meetingA);
    expect(period.complete).toBe(true); expect(period.total_meetings).toBe(1);
    expect((await a.analysesInPeriod("1990-01-01","2030-01-01")).complete).toBe(false);
  });

  test("historical transcript, learned patterns and conversation retrieval are tenant scoped", async () => {
    await a.addMessage("user","Preciso retomar a conversa sobre jabuticabeira.");
    await admin.query(`INSERT INTO coach_messages(user_id,role,content,created_at)
      SELECT $1,'user','Mensagem recente '||n,now() + n * interval '1 second' FROM generate_series(1,105)n`,[userA]);
    await b.addMessage("user","Jabuticabeira confidencial B.");
    expect((await a.messages()).some((m) => m.content.includes("retomar"))).toBe(false);
    const found = await a.context("orquídea"); expect(found.meetings[0].id).toBe(oldMeeting);
    expect((await a.context("empatia")).analyses.length).toBe(2);
    const past = await a.context("jabuticabeira");
    expect(past.messages.length).toBe(1); expect(past.messages[0].content).toContain("retomar");
    expect(past.tasks.length).toBe(1); expect(past.tasks[0].acao).toBe("cobrar");
    expect(past.tasks[0].concluida_em).not.toBeNull(); expect(past.events.length).toBe(1);
    expect(past.events[0].tarefa_titulo).toBe("Entrega delegada concluída");
    expect(JSON.stringify(past)).not.toContain("Segredo B");
    expect(JSON.stringify(past)).not.toContain("Tarefa confidencial B");
  });

  test("today respects local midnight and never relabels historical meetings as today's evidence", async () => {
    const ids = [randomUUID(),randomUUID(),randomUUID()];
    try {
      await admin.query(`INSERT INTO meetings(id,user_id,nome,original_filename,recorded_at,transcription,status)
        VALUES($1,$4,'Dentro do domingo','today.mp3','2026-09-21T02:59:59Z','Uma reunião dentro do dia local.','done'),
          ($2,$4,'Segunda fora do domingo','tomorrow.mp3','2026-09-21T03:00:00Z','Uma reunião fora do dia local.','done'),
          ($3,$5,'Reunião privada B hoje','private.mp3','2026-09-20T15:00:00Z','Reunião de outro usuário.','done')`,[...ids,userA,userB]);
      const current = await a.context("Como foi meu dia hoje?",{now:new Date("2026-09-21T02:00:00Z"),timezone:"America/Sao_Paulo"});
      expect(current.meetings.map(m=>m.id)).toEqual([ids[0]]);
      expect(current.selection.period).toMatchObject({kind:"today",from:"2026-09-20T03:00:00.000Z",to:"2026-09-21T03:00:00.000Z"});
      expect(current.selection.meetings).toEqual({selected:1,total:1});
      expect(current.historical_meetings.every(m=>m.id!==ids[0]&&m.id!==ids[2])).toBe(true);
      expect(JSON.stringify(current)).not.toContain("privada B");
      const empty = await a.context("Revise hoje",{now:new Date("2030-09-20T15:00:00Z"),timezone:"America/Sao_Paulo"});
      expect(empty.meetings).toEqual([]); expect(empty.analyses).toEqual([]);
      expect(empty.selection.meetings).toEqual({selected:0,total:0});
      expect(empty.historical_meetings.length).toBeGreaterThan(0);
      expect(empty.selection.fallback).toBe(false);
      expect(empty.events).toEqual([]);
      const weekly = await a.context("",{period:{from:"2026-09-14T03:00:00Z",to:"2026-09-21T03:00:00Z",label:"revisão"}});
      expect(new Set(weekly.meetings.map(m=>m.id))).toEqual(new Set([meetingA,ids[0]]));
      expect(weekly.selection.period?.kind).toBe("explicit");
    } finally { await admin.query("DELETE FROM meetings WHERE id=ANY($1::uuid[])",[ids]); }
  });

  test("a missing recording date is identified as registration date, never asserted as recorded today", async () => {
    const id = randomUUID();
    try {
      await admin.query(`INSERT INTO meetings(id,user_id,nome,original_filename,recorded_at,created_at,transcription,status)
        VALUES($1,$2,'Importação sem data','imported.mp3',NULL,'2080-09-20T15:00:00Z','Uma reunião antiga importada sem data original.','done')`,[id,userA]);
      const context = await a.context("Como foi hoje?",{now:new Date("2080-09-20T18:00:00Z")});
      expect(context.meetings).toHaveLength(1);
      expect(context.meetings[0]).toMatchObject({id,recorded_at:null,context_at:'2080-09-20T15:00:00.000Z',date_basis:'registered'});
      expect(context.historical_meetings.find(m=>m.id===meetingA)?.date_basis).toBe('recorded');
      const general = await a.context("Importação sem data");
      expect(general.meetings.find(m=>m.id===id)?.date_basis).toBe('registered');
    } finally { await admin.query("DELETE FROM meetings WHERE id=$1",[id]); }
  });

  test("explicit reaffirmation restores a confirmed note's recency without overriding rejected or hypothetical memories", async () => {
    const input = {kind:'goal' as const,content:'Meu objetivo declarado A',status:'confirmed' as const,evidence:[]};
    let revision = (await a.profile()).revision;
    const first = await a.rememberUserNote(input,revision);
    await admin.query("UPDATE coach_memories SET updated_at='2000-01-01' WHERE id=$1",[first.id]);
    const second = await a.rememberUserNote({...input,content:'Meu objetivo declarado B'},revision);
    const again = await a.rememberUserNote(input,revision);
    expect(again.id).toBe(first.id);
    expect((await a.memories())[0].id).toBe(first.id);
    expect(Date.parse(again.updated_at)).toBeGreaterThanOrEqual(Date.parse(second.updated_at));
    expect(again.history.at(-1)).toMatchObject({content:input.content,status:'confirmed'});
    await a.correctMemory(first.id,input.content,'rejected');
    revision = (await a.profile()).revision;
    expect((await a.rememberUserNote(input,revision)).status).toBe('rejected');
    const hypothesis = await a.addMemory({...input,content:'Contexto ainda hipotético',kind:'context',status:'hypothesis'},revision);
    expect((await a.rememberUserNote({...input,content:hypothesis.content,kind:'context'},revision)).status).toBe('hypothesis');
    const foreign = await b.rememberUserNote(input,(await b.profile()).revision);
    expect(foreign.id).not.toBe(first.id); expect(foreign.user_id).toBe(userB);
    expect((await a.memories()).find(m=>m.id===first.id)?.status).toBe('rejected');
    await expect(a.rememberUserNote({...input,kind:'pattern'},revision)).rejects.toThrow();
    await expect(a.rememberUserNote({...input,status:'hypothesis'},revision)).rejects.toThrow();
    await expect(a.rememberUserNote(input,revision-1)).rejects.toBeInstanceOf(StaleCoachRunError);
  });

  test("memory de-duplicates; rejection preserved; user correction invalidates generated writes", async () => {
    const input = {kind:"pattern" as const,content:"Posso estar assumindo muitas frentes.",status:"hypothesis" as const,evidence:[]};
    let revision = (await a.profile()).revision;
    const memory = await a.addMemory(input,revision);
    expect((await a.addMemory(input,revision)).id).toBe(memory.id);
    await a.correctMemory(memory.id,input.content,"rejected");
    await expect(a.addMemory(input,revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    await expect(a.saveReview("2026-09-21",review,"fixture",revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    revision = (await a.profile()).revision;
    expect((await a.addMemory(input,revision)).status).toBe("rejected");
    expect((await a.memories())[0].history.length).toBe(1);
    expect(await b.correctMemory(memory.id,"Cross tenant", "confirmed")).toBeNull();
  });

  test("reviews flag corrected context; replacement is explicit and preserves the weekly id", async () => {
    const revision = (await a.profile()).revision;
    const old = (await a.reviews()).find((r) => r.week_start === "2026-09-14")!;
    expect(old.stale).toBe(true);
    expect(old.profile_revision).toBeLessThan(revision);
    const next = {...review,headline:"Foco corrigido"};
    const retried = await a.saveReview("2026-09-14",next,"fixture-v2",revision);
    expect(retried.id).toBe(old.id); expect(retried.content.headline).toBe(review.headline);
    expect(retried.stale).toBe(true);
    const replaced = await a.saveReview("2026-09-14",next,"fixture-v2",revision,true);
    expect(replaced.id).toBe(old.id); expect(replaced.content.headline).toBe(next.headline);
    expect(replaced.model).toBe("fixture-v2"); expect(replaced.profile_revision).toBe(revision);
    expect(Date.parse(replaced.created_at)).toBeGreaterThan(Date.parse(old.created_at));
    expect(replaced.stale).toBe(false); expect((await a.reviews())[0].stale).toBe(false);
    expect(await b.reviews()).toEqual([]);
  });

  test("changed sources invalidate coverage, context and pending writes; composite FK checks ownership", async () => {
    const revision = (await a.profile()).revision;
    const evidence: Evidence = {meeting_id:meetingA,meeting_title:"A",recorded_at:null,quote:"Vou delegar esta entrega.",start:null,speaker:null,self_attributed:false,chunk_index:0,source_hash:sourceHash(source)};
    const observation: Observation = {competency:"delegation",observation:"Fala",hypothesis:"Hipótese",alternative:"Alternativa",experiment:"Experimento",evidence:[evidence]};
    const memory = await a.addMemory({kind:"pattern",content:"Memória vinculada à fonte",status:"hypothesis",evidence:[evidence]},revision);
    const otherMemory = await a.addMemory({kind:"pattern",content:"Outro registro vinculado",status:"hypothesis",evidence:[evidence]},revision);
    const message = await a.addMessage("assistant","Conversa ancorada em delegação.",[evidence],revision);
    const sourced = await a.saveReview("2026-09-21",{...review,observations:[observation]},"fixture",revision);
    expect(sourced.stale).toBe(false);
    expect((await a.context("ancorada")).messages[0].stale).toBe(false);
    await admin.query("UPDATE meetings SET transcription = transcription || ' Correção de fala.' WHERE id = $1",[meetingA]);
    expect((await a.coverage()).analyzed_chunks).toBe(0);
    expect((await a.context("empatia")).analyses.length).toBe(0);
    expect((await a.memories()).find((m) => m.id === memory.id)?.stale).toBe(true);
    expect((await a.reviews()).find((r) => r.id === sourced.id)?.stale).toBe(true);
    expect((await a.context("ancorada")).messages[0].stale).toBe(true);
    // Force the sourced message into the latest-page window too (fixtures above intentionally use future dates).
    await admin.query("UPDATE coach_messages SET created_at = now() + interval '1 hour' WHERE id = $1",[message.id]);
    expect((await a.messages()).find((m) => m.id === message.id)?.stale).toBe(true);
    await expect(a.addMessage("assistant","Resposta obsoleta",[evidence],revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    await expect(a.addMemory({kind:"pattern",content:"Outra memória",status:"hypothesis",evidence:[evidence]},revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    await expect(a.saveReview("2026-09-21",{...review,observations:[observation]},"fixture",revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    await expect(a.saveAnalysis({meeting_id:meetingA,source_hash:sourceHash(source),chunk_index:0,chunk_count:1,observations:[],summary:"old",model:"fixture"},revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    await expect(withTenant(userA,(db) => db.query(`INSERT INTO coach_analyses(user_id,meeting_id,source_hash,chunk_index,chunk_count,summary,model)
      VALUES($1,$2,'0123456789abcdef',0,1,'Cross tenant','fixture')`,[userA,meetingB]))).rejects.toThrow();
    const edited = await a.correctMemory(memory.id,"Minha interpretação corrigida","hypothesis");
    const confirmed = await a.correctMemory(otherMemory.id,otherMemory.content,"confirmed");
    expect(edited?.evidence).toEqual([]); expect(confirmed?.evidence).toEqual([]);
    const memories = await a.memories();
    expect(memories.find((m) => m.id === memory.id)?.stale).toBe(false);
    expect(memories.find((m) => m.id === otherMemory.id)?.stale).toBe(false);
    expect(edited?.history.at(-1)?.content).toBe(memory.content);
  });

  test("reset removes private coach data, keeps meetings, and blocks in-flight repopulation", async () => {
    const revision = (await a.profile()).revision;
    await a.reset();
    expect((await a.profile()).enabled).toBe(false);
    expect((await a.profile()).revision).toBeGreaterThan(revision);
    expect(await a.memories()).toEqual([]); expect(await a.messages()).toEqual([]); expect(await a.reviews()).toEqual([]);
    expect((await a.coverage()).total_meetings).toBe(105);
    await expect(a.addMessage("assistant","Stale reply",[],revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    expect((await b.messages()).length).toBe(1);
  });
});

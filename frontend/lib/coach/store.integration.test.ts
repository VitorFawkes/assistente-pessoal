import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { reportSources, reportPeriodFingerprint } from "./meeting-reports";
import { chunkMeeting, sourceHash } from "./evidence";
import { coachStore, enabledUserIds, GoalLimitError, StaleCoachRunError } from "./store";
import { createCommitment, updateCommitment, listCommitments } from "./coach-commitments";
import { indexChunk, semanticSearch, recordModelRuns } from "./retrieval";
import type { CoachTelemetry } from "./model";
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
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS raw_ai_response jsonb;
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
    const lifecycleMigration = await readFile(new URL("../../../db/0029_coach_memory_lifecycle.sql", import.meta.url), "utf8");
    await admin.query(lifecycleMigration); await admin.query(lifecycleMigration);
    await admin.query(await readFile(new URL("../../../db/0030_coach_jobs.sql",import.meta.url),"utf8"));
    const retrievalMigration=await readFile(new URL("../../../db/0031_coach_retrieval.sql",import.meta.url),"utf8");
    await admin.query(retrievalMigration);await admin.query(retrievalMigration);
    await admin.query(await readFile(new URL("../../../db/0032_coach_calendar_cache.sql",import.meta.url),"utf8"));
    await admin.query(await readFile(new URL("../../../db/0033_coach_report_context.sql",import.meta.url),"utf8"));
    const lineageMigration=await readFile(new URL("../../../db/0034_coach_context_lineage.sql",import.meta.url),"utf8");
    await admin.query(lineageMigration);await admin.query(lineageMigration);
    const goalsMigration=await readFile(new URL("../../../db/0039_coach_goals_areas.sql",import.meta.url),"utf8");
    await admin.query(goalsMigration);await admin.query(goalsMigration);
    await admin.query("ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS situacao_desde timestamptz");
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
    expect(await a.coverage()).toMatchObject({total_meetings:105,analyzed_meetings:0,analyzed_chunks:1,pending_meetings:103,report_ready_meetings:2,summary_only_meetings:2});
    await a.saveAnalysis({...input,chunk_index:1},revision);
    expect(await a.coverage()).toMatchObject({total_meetings:105,analyzed_meetings:1,analyzed_chunks:2,pending_meetings:103,report_ready_meetings:2});
    expect((await a.saveReview("2026-09-14",review,"fixture",revision)).id)
      .toBe((await a.saveReview("2026-09-14",review,"fixture",revision)).id);
    expect((await b.analyses()).length).toBe(0);
    const period = await a.analysesInPeriod("2026-09-14","2026-09-21");
    expect(period.analyses.length).toBe(2); expect(period.meetings[0].id).toBe(meetingA);
    expect(period.complete).toBe(true); expect(period.total_meetings).toBe(1);
    expect((await a.analysesInPeriod("1990-01-01","2030-01-01")).behavioral_complete).toBe(false);
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
      const weekly=await a.analysesInPeriod('2080-09-20T00:00:00Z','2080-09-21T00:00:00Z');
      expect(weekly.meetings[0]).toMatchObject({id,recorded_at:null,context_at:'2080-09-20T15:00:00.000Z',date_basis:'registered'});
      expect(weekly.limitations.join(' ')).toContain('cadastro/importação');
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

  test("goal replacement is atomic, revision guarded and preserves historical intent", async () => {
    const old=await a.addMemory({kind:"goal",content:"Priorizar projeto anterior",status:"confirmed",evidence:[]});
    const revision=(await a.profile()).revision;
    const before=new Date().toISOString();
    await new Promise(resolve=>setTimeout(resolve,5));
    const result=await a.transitionMemory(old.id,{lifecycle:"superseded",replacement:{content:"Concluir proposta do cliente"}},revision);
    expect(result?.previous.lifecycle).toBe("superseded");
    expect(result?.current.supersedes_id).toBe(old.id);
    expect(result?.revision).toBe(revision+1);
    expect((await a.memoriesAt(before)).find(m=>m.id===old.id)?.lifecycle).toBe("active");
    expect((await a.memoryContext()).active_goals.some(m=>m.id===old.id)).toBe(false);
    expect((await a.memoryContext()).active_goals.some(m=>m.id===result?.current.id)).toBe(true);
    await expect(a.transitionMemory(old.id,{lifecycle:"paused"},revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    expect(await b.transitionMemory(old.id,{lifecycle:"paused"})).toBeNull();
  });

  test("generated paraphrases cannot resurrect corrected sources", async () => {
    const current=(await a.meetingById(meetingA))!;
    const evidence:Evidence={meeting_id:meetingA,meeting_title:"A",recorded_at:null,quote:"Vou delegar esta entrega.",start:null,speaker:null,self_attributed:false,chunk_index:0,source_hash:sourceHash(current)};
    const original=await a.addMemory({kind:"pattern",content:"Hipótese nova para rejeitar",status:"hypothesis",evidence:[evidence]});
    await a.correctMemory(original.id,"A situação teve outra causa","confirmed");
    const revision=(await a.profile()).revision;
    await expect(a.addMemory({kind:"pattern",content:"Outra redação da acusação",status:"hypothesis",evidence:[evidence]},revision)).rejects.toThrow();
    await expect(a.correctMemory(original.id,"corrida antiga","confirmed",revision-1)).rejects.toBeInstanceOf(StaleCoachRunError);
  });

  test("retry-safe messages preserve identity and cannot expose another tenant key", async () => {
    const revision=(await a.profile()).revision;
    const first=await a.addMessage("user","Pedido de teste",[],revision,"job-fixture:user");
    const again=await a.addMessage("user","Pedido de teste",[],revision,"job-fixture:user");
    expect(again.id).toBe(first.id);
    expect((await a.messageByKey("job-fixture:user"))?.id).toBe(first.id);
    expect(await b.messageByKey("job-fixture:user")).toBeNull();
    await expect(a.addMessage("assistant","Outra saída",[],revision,"job-fixture:user")).rejects.toThrow();
  });

  test("settings goals replace prior priorities and cadence remains opted out by default", async () => {
    const defaultProfile=await a.profile();
    expect(defaultProfile.morning_enabled).toBe(false);expect(defaultProfile.evening_enabled).toBe(false);expect(defaultProfile.nudges_enabled).toBe(false);
    await a.saveProfile({goals:"Prioridade completa vinda dos ajustes",morning_enabled:true,morning_hour:9});
    const packet=await a.memoryContext();
    expect(packet.active_goals.map(m=>m.content)).toEqual(["Prioridade completa vinda dos ajustes"]);
    expect(packet.legacy_goals).toBeNull();
    expect((await a.profile()).morning_hour).toBe(9);
    const goal=packet.active_goals[0];
    await a.transitionMemory(goal.id,{lifecycle:"paused"});
    expect((await a.profile()).goals).toBe("");
    expect((await a.memoryContext()).active_goals).toEqual([]);
    expect((await a.memoryContext()).legacy_goals).toBeNull();
  });

  test("a generated hypothesis can never mark itself confirmed", async () => {
    await expect(a.addMemory({kind:"pattern",content:"I certify my own interpretation",status:"confirmed",evidence:[]},(await a.profile()).revision)).rejects.toThrow();
  });

  test("conversational corrections advance their own running job but external edits invalidate it", async()=>{
    const memory=await a.addMemory({kind:"context",content:"Antes da correção do job",status:"confirmed",evidence:[]});
    let revision=(await a.profile()).revision;const jobId=randomUUID();
    await admin.query("INSERT INTO coach_jobs(id,user_id,kind,idempotency_key,status,profile_revision,lease_token,lease_until) VALUES($1,$2,'chat',$3,'running',$4,$5,now()+interval '5 minutes')",[jobId,userA,jobId,revision,randomUUID()]);
    await a.correctMemory(memory.id,"Corrigido pelo usuário no job","confirmed",revision,jobId);
    revision=(await a.profile()).revision;
    expect((await admin.query("SELECT profile_revision FROM coach_jobs WHERE id=$1",[jobId])).rows[0].profile_revision).toBe(revision);
    await a.transitionMemory(memory.id,{lifecycle:"paused"},revision,jobId);
    revision=(await a.profile()).revision;
    expect((await admin.query("SELECT profile_revision FROM coach_jobs WHERE id=$1",[jobId])).rows[0].profile_revision).toBe(revision);
    await a.saveProfile({evening_enabled:true},revision,jobId);
    revision=(await a.profile()).revision;
    expect((await admin.query("SELECT profile_revision FROM coach_jobs WHERE id=$1",[jobId])).rows[0].profile_revision).toBe(revision);
    await a.saveProfile({evening_enabled:false});
    expect((await a.profile()).revision).toBeGreaterThan(revision);
    expect((await admin.query("SELECT profile_revision FROM coach_jobs WHERE id=$1",[jobId])).rows[0].profile_revision).toBe(revision);
  });

  test("profile mutations persist an owner-scoped crash receipt atomically and leave a second goal untouched",async()=>{
    const first=await a.addMemory({kind:"goal",content:"Objetivo A para recibo",status:"confirmed",evidence:[]});
    const second=await a.addMemory({kind:"goal",content:"Objetivo B que segue ativo",status:"confirmed",evidence:[]});
    let revision=(await a.profile()).revision;const jobId=randomUUID();
    await admin.query("INSERT INTO coach_jobs(id,user_id,kind,idempotency_key,status,profile_revision,lease_token,lease_until) VALUES($1,$2,'chat',$3,'running',$4,$5,now()+interval '5 minutes')",[jobId,userA,jobId,revision,randomUUID()]);
    expect(await a.runReceipt(jobId)).toBeNull();
    await a.transitionMemory(first.id,{lifecycle:"paused"},revision,jobId);
    expect(await a.runReceipt(jobId)).toContain("Pausei um objetivo");
    expect(await b.runReceipt(jobId)).toBeNull();
    expect((await a.memories()).find(m=>m.id===second.id)?.lifecycle).toBe("active");
    revision=(await a.profile()).revision;
    await a.correctMemory(first.id,"Objetivo A corrigido no mesmo job","confirmed",revision,jobId);
    expect(await a.runReceipt(jobId)).toContain("Corrigi uma memória");
    revision=(await a.profile()).revision;
    await a.saveProfile({morning_enabled:true},revision,jobId);
    expect(await a.runReceipt(jobId)).toContain("preferências de acompanhamento");
    const before=await a.runReceipt(jobId);
    revision=(await a.profile()).revision;
    await expect(a.transitionMemory(second.id,{lifecycle:"paused"},revision,randomUUID())).rejects.toBeInstanceOf(StaleCoachRunError);
    expect((await a.memories()).find(m=>m.id===second.id)?.lifecycle).toBe("active");
    expect((await a.profile()).revision).toBe(revision);
    expect(await a.runReceipt(jobId)).toBe(before);
  });

  test("accepted commitment and task are atomic and idempotent across retries", async () => {
    const revision=(await a.profile()).revision;
    const message=await a.addMessage("user","Crie uma tarefa para entregar a proposta",[],revision);
    const input={accepted:true as const,idempotency_key:"commitment-fixture-key",source_message_id:message.id,title:"Entregar a proposta",due_at:"2026-09-25T15:00:00Z"};
    const [first,again]=await Promise.all([createCommitment(userA,input,revision),createCommitment(userA,input,revision)]);
    expect(again.id).toBe(first.id);expect(again.tarefa_id).toBe(first.tarefa_id);
    expect((await a.profile()).revision).toBe(revision+1);
    await expect(a.saveReview("1998-08-10",review,"fixture",revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    const rows=await admin.query("SELECT count(*)::int AS total FROM tarefa_eventos WHERE tarefa_id=$1 AND evento='criada'",[first.tarefa_id]);
    expect(rows.rows[0].total).toBe(1);
    expect((await listCommitments(userA)).find(c=>c.id===first.id)?.status).toBe("open");
    expect(await listCommitments(userB)).toEqual([]);
    await expect(createCommitment(userA,{...input,title:"Outro pedido"},(await a.profile()).revision)).rejects.toThrow();
    await expect(createCommitment(userB,{...input,idempotency_key:"cross-tenant-key"},(await b.profile()).revision)).rejects.toThrow();
    const assistant=await a.addMessage("assistant","Você poderia criar uma tarefa",[],(await a.profile()).revision);
    await expect(createCommitment(userA,{...input,source_message_id:assistant.id,idempotency_key:"assistant-key"},(await a.profile()).revision)).rejects.toThrow();
    await expect(createCommitment(userA,{...input,accepted:false as unknown as true,idempotency_key:"unaccepted-key"},(await a.profile()).revision)).rejects.toThrow();
    const complete=await updateCommitment(userA,first.id,{status:"completed",outcome:"Enviei a proposta"},(await a.profile()).revision);
    expect(complete?.outcome_source).toBe("user_report");
    const task=(await admin.query("SELECT status,concluida_em FROM tarefas WHERE id=$1",[first.tarefa_id])).rows[0];
    expect(task.status).toBe("concluida");expect(task.concluida_em).not.toBeNull();
    await updateCommitment(userA,first.id,{status:"renegotiated",due_at:"2026-10-01T15:00:00Z",outcome:"Prazo combinado mudou"},(await a.profile()).revision);
    await admin.query("UPDATE tarefas SET status='concluida',concluida_em=now() WHERE id=$1",[first.tarefa_id]);
    const external=(await listCommitments(userA)).find(c=>c.id===first.id)!;
    expect(external.status).toBe("completed");expect(external.outcome_source).toBe("task_record");
    await updateCommitment(userA,first.id,{status:"completed",outcome:"Concluído de novo"},(await a.profile()).revision);
    await admin.query("UPDATE tarefas SET status='aberta',concluida_em=NULL,updated_at=now()+interval '1 second' WHERE id=$1",[first.tarefa_id]);
    const reopened=(await listCommitments(userA)).find(c=>c.id===first.id)!;
    expect(reopened.status).toBe("open");expect(reopened.outcome_source).toBe("task_record");
    expect(await updateCommitment(userB,first.id,{status:"cancelled"})).toBeNull();
  });

  test("assistant replies do not evict user statements from the accountability history",async()=>{
    const before=await a.userMessages();expect(before.length).toBeGreaterThan(0);
    await admin.query(`INSERT INTO coach_messages(user_id,role,content) SELECT $1,'assistant','Synthetic follow-up '||n FROM generate_series(1,105) n`,[userA]);
    expect((await a.userMessages()).map(m=>m.id)).toEqual(before.map(m=>m.id));
    expect((await a.userMessages()).every(m=>m.role==="user")).toBe(true);
  });

  test("semantic index and usage are isolated, current-source checked, and revision guarded",async()=>{
    const oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY,oldFlag=process.env.COACH_SEMANTIC_ENABLED;
    process.env.OPENAI_API_KEY="fixture-not-real";process.env.COACH_SEMANTIC_ENABLED="true";
    let invalidate=false,calls=0;
    globalThis.fetch=(async()=>{calls++;if(invalidate)await a.saveProfile({context:"Changed while embedding"});return Response.json({data:[{embedding:Array.from({length:1536},(_,i)=>i===0?1:0)}]});}) as unknown as typeof fetch;
    try{
      let revision=(await a.profile()).revision;const meeting=(await a.meetingById(meetingA))!;const chunk=chunkMeeting(meeting)[0];
      expect(await indexChunk(userA,meeting,chunk,revision)).toBe(true);
      expect(await indexChunk(userA,meeting,chunk,revision)).toBe(false);expect(calls).toBe(1);
      expect((await semanticSearch(userA,"delegação")).matches[0].meeting_id).toBe(meetingA);
      expect((await semanticSearch(userB,"delegação")).matches).toEqual([]);
      expect((await withTenant(userB,db=>db.query("SELECT * FROM coach_semantic_chunks"))).rowCount).toBe(0);
      expect((await getPool().query("SELECT * FROM coach_semantic_chunks")).rowCount).toBe(0);
      await expect(withTenant(userA,db=>db.query("INSERT INTO coach_semantic_chunks(user_id,meeting_id,chunk_index,source_hash,embedding,embedding_model) VALUES($1,$2,0,'hash',$3,'fixture')",[userB,meetingB,Array(1536).fill(0)]))).rejects.toThrow();
      await withTenant(userA,db=>db.query("DELETE FROM coach_semantic_chunks WHERE user_id=$1",[userA]));invalidate=true;
      expect(await indexChunk(userA,meeting,chunk,revision)).toBe(false);invalidate=false;
      expect((await semanticSearch(userA,"delegação")).matches).toEqual([]);
      revision=(await a.profile()).revision;expect(await indexChunk(userA,meeting,chunk,revision)).toBe(true);
      const event:CoachTelemetry={provider:"openai",model:"fixture",role:"primary",reasoningEffort:"high",effectiveReasoningEffort:"high",requests:1,toolCalls:0,inputTokens:11,outputTokens:7,cachedInputTokens:3,usageComplete:false,latencyMs:12,success:true};
      await recordModelRuns(userA,"fixture",null,[event],revision);
      const recorded=(await withTenant(userA,db=>db.query("SELECT input_tokens,cached_input_tokens,usage_complete FROM coach_model_runs WHERE user_id=$1",[userA]))).rows[0];
      expect(recorded).toEqual({input_tokens:"11",cached_input_tokens:"3",usage_complete:false});
      await recordModelRuns(userA,"stale",null,[event],revision-1);
      expect((await withTenant(userA,db=>db.query("SELECT * FROM coach_model_runs WHERE user_id=$1",[userA]))).rowCount).toBe(1);
      expect((await withTenant(userB,db=>db.query("SELECT * FROM coach_model_runs"))).rowCount).toBe(0);
    }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldFlag===undefined)delete process.env.COACH_SEMANTIC_ENABLED;else process.env.COACH_SEMANTIC_ENABLED=oldFlag;}
  });

  test("all period reports come from raw pipeline JSON and remain tenant scoped beyond eight meetings",async()=>{
    const ids=Array.from({length:12},()=>randomUUID());
    try{
      for(const [index,id] of ids.entries())await admin.query(`INSERT INTO meetings(id,user_id,original_filename,recorded_at,transcription,status,summary,raw_ai_response) VALUES($1,$2,'report-fixture.mp3','2035-01-01T12:00:00Z','Fonte original','done','Resumo curto',$3::jsonb)`,[id,userA,JSON.stringify({executive_summary:`Decisão de relatório ${index}`})]);
      const context=await a.context("como foi hoje",{now:new Date("2035-01-01T23:00:00Z"),timezone:"America/Sao_Paulo"});
      expect(context.meetings).toHaveLength(12);expect(context.selection.meetings).toEqual({selected:12,total:12});
      expect(context.meetings.every(meeting=>meeting.executive_summary?.startsWith("Decisão de relatório"))).toBe(true);
      expect((await b.context("como foi hoje",{now:new Date("2035-01-01T23:00:00Z"),timezone:"America/Sao_Paulo"})).meetings).toEqual([]);
      const period=await a.analysesInPeriod("2035-01-01","2035-01-02");
      expect(period.complete).toBe(true);expect(period.behavioral_complete).toBe(false);expect(period.meetings).toHaveLength(12);
    }finally{await admin.query("DELETE FROM meetings WHERE id=ANY($1::uuid[])",[ids]);}
  });

  test("changed reports invalidate saved guidance and prevent stale or cross-tenant context writes",async()=>{
    const revision=(await a.profile()).revision;
    const meeting=(await a.meetingById(meetingA))!;
    const sources=reportSources([meeting]);
    const message=await a.addMessage("assistant","report-context-fixture",[],revision,undefined,sources);
    await admin.query("UPDATE coach_messages SET created_at=now()+interval '1 day' WHERE id=$1",[message.id]);
    expect((await a.messages()).find(item=>item.id===message.id)).toMatchObject({stale:false,context_freshness:"current"});
    const from="2026-09-14T00:00:00Z",to="2026-09-21T00:00:00Z";
    const period=await a.analysesInPeriod(from,to);
    const content={...review,report_context:{from,to,fingerprint:reportPeriodFingerprint(period.meetings)}};
    const saved=await a.saveReview("2026-09-14",content,"fixture",revision,true);
    const original=(await admin.query("SELECT raw_ai_response FROM meetings WHERE id=$1",[meetingA])).rows[0].raw_ai_response;
    try{
      await admin.query(`UPDATE meetings SET raw_ai_response=jsonb_build_object('executive_summary','Relatório corrigido depois da resposta') WHERE id=$1`,[meetingA]);
      expect((await a.messages()).find(item=>item.id===message.id)).toMatchObject({stale:true,context_freshness:"stale"});
      expect((await a.reviews()).find(item=>item.id===saved.id)?.stale).toBe(true);
      await expect(a.addMessage("assistant","Deve falhar",[],revision,undefined,sources)).rejects.toBeInstanceOf(StaleCoachRunError);
      await expect(a.saveReview("2026-09-14",content,"fixture",revision,true)).rejects.toBeInstanceOf(StaleCoachRunError);
      await expect(b.addMessage("assistant","Não pode referenciar outro usuário",[],(await b.profile()).revision,undefined,sources)).rejects.toBeInstanceOf(StaleCoachRunError);
    }finally{await admin.query("UPDATE meetings SET raw_ai_response=$2::jsonb WHERE id=$1",[meetingA,original===null?null:JSON.stringify(original)]);}
  });

  test("weekly report versions cover historical tool reads outside the review period",async()=>{
    const revision=(await a.profile()).revision;
    const from="2026-09-14T00:00:00Z",to="2026-09-21T00:00:00Z";
    const period=await a.analysesInPeriod(from,to);
    const historical=(await a.meetingById(oldMeeting))!;
    const content:ReviewContent&{context_sources:ReturnType<typeof reportSources>}={...review,report_context:{from,to,fingerprint:reportPeriodFingerprint(period.meetings)},context_sources:reportSources([...period.meetings,historical])};
    const saved=await a.saveReview("2026-09-14",content,"fixture",revision,true);
    const original=(await admin.query("SELECT raw_ai_response FROM meetings WHERE id=$1",[oldMeeting])).rows[0].raw_ai_response;
    try{
      await admin.query(`UPDATE meetings SET raw_ai_response=jsonb_build_object('executive_summary','Histórico corrigido depois da consulta por ferramenta') WHERE id=$1`,[oldMeeting]);
      expect((await a.analysesInPeriod(from,to)).report_fingerprint).toBe(content.report_context!.fingerprint);
      expect((await a.reviews()).find(item=>item.id===saved.id)?.stale).toBe(true);
      await expect(a.saveReview("2026-09-14",content,"fixture",revision,true)).rejects.toBeInstanceOf(StaleCoachRunError);
      const foreign=(await b.meetingById(meetingB))!;
      await expect(a.saveReview("2026-09-14",{...content,context_sources:reportSources([foreign])},"fixture",revision,true)).rejects.toBeInstanceOf(StaleCoachRunError);
    }finally{await admin.query("UPDATE meetings SET raw_ai_response=$2::jsonb WHERE id=$1",[oldMeeting,original===null?null:JSON.stringify(original)]);}
  });

  test("inherited empty-period membership invalidates descendant guidance and rejects in-flight saves",async()=>{
    const revision=(await a.profile()).revision;
    const from="2040-01-01T00:00:00Z",to="2040-01-08T00:00:00Z";
    const period=await a.analysesInPeriod(from,to);
    const inherited={from,to,fingerprint:period.report_fingerprint};
    const message=await a.addMessage("assistant","Descendant of an empty-period review",[],revision,undefined,[],[inherited]);
    await admin.query("UPDATE coach_messages SET created_at=now()+interval '1 day' WHERE id=$1",[message.id]);
    const content={...review,context_periods:[inherited]};
    const saved=await a.saveReview("2040-01-09",content,"fixture",revision,true);
    const foreign=randomUUID(),own=randomUUID();
    try{
      await admin.query(`INSERT INTO meetings(id,user_id,original_filename,recorded_at,transcription,status) VALUES($1,$2,'late-foreign.mp3','2040-01-03','Fonte de outro usuário','done')`,[foreign,userB]);
      expect((await a.messages()).find(item=>item.id===message.id)).toMatchObject({stale:false,context_periods:[inherited]});
      expect((await a.reviews()).find(item=>item.id===saved.id)?.stale).toBe(false);
      await admin.query(`INSERT INTO meetings(id,user_id,original_filename,recorded_at,transcription,status) VALUES($1,$2,'late-own.mp3','2040-01-03','Fonte recebida depois','done')`,[own,userA]);
      expect((await a.messages()).find(item=>item.id===message.id)).toMatchObject({stale:true,context_freshness:"stale"});
      expect((await a.reviews()).find(item=>item.id===saved.id)?.stale).toBe(true);
      await expect(a.addMessage("assistant","Late descendant must fail",[],revision,undefined,[],[inherited])).rejects.toBeInstanceOf(StaleCoachRunError);
      await expect(a.saveReview("2040-01-09",content,"fixture",revision,true)).rejects.toBeInstanceOf(StaleCoachRunError);
    }finally{await admin.query("DELETE FROM meetings WHERE id=ANY($1::uuid[])",[[foreign,own]]);}
  });

  test("new zero-report conversations stay current while legacy zero-report guidance stays unknown",async()=>{
    const revision=(await a.profile()).revision;
    const message=await a.addMessage("assistant","Zero reports but meaningful conversational advice",[],revision);
    await admin.query("UPDATE coach_messages SET created_at=now()+interval '1 day' WHERE id=$1",[message.id]);
    expect((await a.messages()).find(item=>item.id===message.id)?.context_freshness).toBe("current");
    await admin.query("UPDATE coach_messages SET context_version=1 WHERE id=$1",[message.id]);
    expect((await a.messages()).find(item=>item.id===message.id)?.context_freshness).toBe("unknown");
    await admin.query("UPDATE coach_messages SET context_version=NULL WHERE id=$1",[message.id]);
    expect((await a.messages()).find(item=>item.id===message.id)?.context_freshness).toBe("unknown");
  });

  test("pre-lineage reviews remain visible but cannot be reused as current guidance",async()=>{
    const revision=(await a.profile()).revision;
    const saved=await a.saveReview("2041-01-01",review,"fixture",revision,true);
    expect(saved.stale).toBe(false);
    await admin.query("UPDATE coach_reviews SET content=content-'context_version' WHERE id=$1",[saved.id]);
    expect((await a.reviews()).find(item=>item.id===saved.id)?.stale).toBe(true);
    expect((await a.saveReview("2041-01-01",review,"fixture",revision,true)).stale).toBe(false);
  });

  test("objetivos: até 3 por área, os de vida fora do perfil e do contexto de trabalho", async () => {
    const userC = randomUUID();
    await admin.query("INSERT INTO users (id,nome,consent_terms_at) VALUES ($1,'Fixture C',now())", [userC]);
    const c = coachStore(userC);
    await c.saveProfile({ enabled: true });
    for (const content of ["Produção rodando no TARS", "Contratar a closer", "Fechar o orçamento de 2027"]) await c.saveGoal({ area: "work", content, due: null, measure: null });
    await expect(c.saveGoal({ area: "work", content: "Quarto objetivo", due: null, measure: null })).rejects.toBeInstanceOf(GoalLimitError);
    await c.saveGoal({ area: "life", content: "Correr uma meia maratona", due: "2026-12-06", measure: "terminar a prova" });
    const profile = await c.profile();
    expect(profile.goals).toContain("Contratar a closer");
    expect(profile.goals).not.toContain("maratona");
    expect((await c.memoryContext()).active_goals.map(g => g.content)).not.toContain("Correr uma meia maratona");
    expect((await c.memoryContext(undefined, true)).active_goals.map(g => g.content)).toContain("Correr uma meia maratona");
    const goals = await c.goals();
    expect(goals.find(g => g.area === "life")).toMatchObject({ content: "Correr uma meia maratona", due: "2026-12-06", measure: "terminar a prova", lifecycle: "active" });
    const first = goals.find(g => g.content === "Produção rodando no TARS")!;
    await c.transitionMemory(first.id, { lifecycle: "paused" });
    await c.saveGoal({ area: "work", content: "Quarto objetivo", due: null, measure: null });
    await expect(c.transitionMemory(first.id, { lifecycle: "active" })).rejects.toBeInstanceOf(GoalLimitError);
    const note = await c.rememberUserNote({ kind: "goal", content: "Meu objetivo de trabalho é revisar o funil", status: "confirmed", evidence: [] }, (await c.profile()).revision);
    expect(note).toMatchObject({ lifecycle: "paused", goal_area: "work" });
  });

  test("reset removes private coach data, keeps meetings, and blocks in-flight repopulation", async () => {
    const revision = (await a.profile()).revision;
    await a.reset();
    expect((await a.profile()).enabled).toBe(false);
    expect((await a.profile()).revision).toBeGreaterThan(revision);
    expect(await listCommitments(userA)).toEqual([]);
    for(const table of ["coach_jobs","coach_semantic_chunks","coach_model_runs"]){
      expect((await withTenant(userA,db=>db.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[userA]))).rowCount).toBe(0);
    }
    expect(await a.memories()).toEqual([]); expect(await a.messages()).toEqual([]); expect(await a.reviews()).toEqual([]);
    expect((await a.coverage()).total_meetings).toBe(105);
    await expect(a.addMessage("assistant","Stale reply",[],revision)).rejects.toBeInstanceOf(StaleCoachRunError);
    expect((await b.messages()).length).toBe(1);
  });
});

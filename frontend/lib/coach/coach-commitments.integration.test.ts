import {afterAll,beforeAll,describe,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {withTenant} from "../db";
import {createCommitment,listCommitments,recordCommitmentOutcome,trackCommitment,updateCommitment} from "./coach-commitments";
import {StaleCoachRunError} from "./store";

const connection=process.env.COACH_TEST_DATABASE_URL;
describe.skipIf(!connection)("accepted steps: real isolated Postgres lifecycle",()=>{
 const user=randomUUID(),other=randomUUID(),schema="commitments_"+randomUUID().replaceAll("-","");
 let admin:Pool;let original:string|undefined;
 const revision=async()=>Number((await admin.query("SELECT revision FROM coach_profiles WHERE user_id=$1",[user])).rows[0].revision);
 const message=async(content:string,owner=user,role="user")=>(await admin.query("INSERT INTO coach_messages(user_id,role,content) VALUES($1,$2,$3) RETURNING id",[owner,role,content])).rows[0].id as string;
 beforeAll(async()=>{
  const url=new URL(connection!);if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.pathname!=="/coach_test")throw new Error("Local dedicated coach_test database required");
  admin=new Pool({connectionString:connection,max:1});
  await admin.query(`CREATE SCHEMA ${schema};SET search_path=${schema};GRANT USAGE ON SCHEMA ${schema} TO app_tenant,app_writer;
   CREATE TABLE users(id uuid PRIMARY KEY);CREATE TABLE meetings(id uuid,user_id uuid,PRIMARY KEY(id,user_id));
   CREATE TABLE tarefas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),titulo text,descricao text,owner text,acao text,prazo timestamptz,prioridade text,status text,
    updated_at timestamptz DEFAULT now(),situacao_desde timestamptz DEFAULT now(),concluida_em timestamptz,cancelada_em timestamptz);
   CREATE TABLE tarefa_eventos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tarefa_id uuid REFERENCES tarefas(id) ON DELETE CASCADE,evento text,payload jsonb);
   ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;ALTER TABLE tarefas FORCE ROW LEVEL SECURITY;
   CREATE POLICY fixture_tenant ON tarefas USING(user_id::text=current_setting('app.current_user_id',true));
   GRANT SELECT,INSERT,UPDATE,DELETE ON tarefas,tarefa_eventos TO app_tenant,app_writer;`);
  for(const name of ["0028_leadership_coach.sql","0029_coach_memory_lifecycle.sql","0030_coach_jobs.sql"])await admin.query(await readFile(new URL("../../../db/"+name,import.meta.url),"utf8"));
  await admin.query("INSERT INTO users(id) VALUES($1),($2)",[user,other]);
  await admin.query("INSERT INTO coach_profiles(user_id,enabled) VALUES($1,true),($2,true)",[user,other]);
  original=process.env.DATABASE_URL;await global.__pgPool?.end();global.__pgPool=undefined;
  url.username="app_tenant";url.password="";url.searchParams.set("options",`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
 });
 afterAll(async()=>{await global.__pgPool?.end();global.__pgPool=undefined;if(original===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=original;await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin?.end();});
 test("literal agreement is durable and retry-safe without creating a task",async()=>{
  const title="Vou enviar a proposta Aurora hoje.",source_message_id=await message(title),before=await revision();
  const input={accepted:true as const,title,source_message_id,idempotency_key:"track:agreement-fixture:0",due_at:null};
  const [first,again]=await Promise.all([trackCommitment(user,input,before),trackCommitment(user,input,before)]);
  expect(first.id).toBe(again.id);expect(first.profile_revision).toBe(before+1);expect(again.profile_revision).toBe(before+1);expect(first.tarefa_id).toBeNull();expect(first.status).toBe("open");expect(first.due_at).toBeNull();
  expect((await listCommitments(user)).find(c=>c.id===first.id)?.status).toBe("open");
  expect(Number((await admin.query("SELECT count(*) AS n FROM tarefas")).rows[0].n)).toBe(0);
  expect(await revision()).toBe(before+1);
  await expect(trackCommitment(user,{...input,idempotency_key:"track:invented-date:0",due_at:"2026-09-23"},await revision())).rejects.toThrow();
  await expect(trackCommitment(user,{...input,idempotency_key:"track:stale-fixture:0"},before)).rejects.toBeInstanceOf(StaleCoachRunError);
  await updateCommitment(user,first.id,{status:"completed",outcome:"Concluí a proposta Aurora."},await revision());
  expect((await listCommitments(user)).find(c=>c.id===first.id)?.status).toBe("completed");
 });
test("a blocker preserves task state and a replay cannot overwrite a newer result",async()=>{
  const source_message_id=await message("Crie uma tarefa para revisar o contrato Boreal.");
  const agreement=await createCommitment(user,{accepted:true,source_message_id,idempotency_key:"fixture:boreal:task",title:"Revisar o contrato Boreal"},await revision());
  await admin.query("UPDATE tarefas SET status='em_andamento',situacao_desde='2026-09-20',updated_at='2026-09-20' WHERE id=$1",[agreement.tarefa_id]);
  const taskBefore=(await admin.query("SELECT status,situacao_desde,updated_at,concluida_em,prazo FROM tarefas WHERE id=$1",[agreement.tarefa_id])).rows[0];
  const outcome="Não consegui revisar o contrato Boreal porque faltou a assinatura.",reportId=await message(outcome),before=await revision();
  const first=await recordCommitmentOutcome(user,agreement.id,{source_message_id:reportId,outcome},before);
  expect(first?.profile_revision).toBe(before+1);expect(first?.status).toBe("open");expect(first?.outcome).toBe(outcome);expect(first?.outcome_source).toBe("user_report");
  expect(first?.history.at(-1)?.source_message_id).toBe(reportId);expect(await revision()).toBe(before+1);
  const taskAfter=(await admin.query("SELECT status,situacao_desde,updated_at,concluida_em,prazo FROM tarefas WHERE id=$1",[agreement.tarefa_id])).rows[0];
  expect(taskAfter).toEqual(taskBefore);
  await recordCommitmentOutcome(user,agreement.id,{source_message_id:reportId,outcome},before);
  expect(await revision()).toBe(before+1);
  const next="Avancei no contrato Boreal, mas falta revisar o preço.",nextId=await message(next);
  await recordCommitmentOutcome(user,agreement.id,{source_message_id:nextId,outcome:next},await revision());
  const current=await recordCommitmentOutcome(user,agreement.id,{source_message_id:reportId,outcome},before);
  expect(current?.outcome).toBe(next);expect(current?.history.filter(h=>h.source_message_id===reportId)).toHaveLength(1);
  expect(Number((await admin.query("SELECT count(*) AS n FROM tarefa_eventos WHERE tarefa_id=$1",[agreement.tarefa_id])).rows[0].n)).toBe(1);
 });
 test("another tenant, a hypothetical agreement and a fabricated outcome are rejected",async()=>{
  const title="Vou revisar o orçamento Cedro.",source_message_id=await message(title);
  const input={accepted:true as const,title,source_message_id,idempotency_key:"track:cedro-fixture:0"};
  const saved=await trackCommitment(user,input,await revision());
  expect(await listCommitments(other)).toEqual([]);
  await expect(trackCommitment(other,{...input,idempotency_key:"track:foreign-fixture:0"},1)).rejects.toThrow();
  const hypothetical=await message("Imagine que vou revisar o orçamento Cedro.");
  await expect(trackCommitment(user,{...input,source_message_id:hypothetical,idempotency_key:"track:hypothetical:0"},await revision())).rejects.toThrow();
  const reportId=await message("Não consegui revisar o orçamento Cedro.");
  expect(await recordCommitmentOutcome(other,saved.id,{source_message_id:reportId,outcome:"Não consegui revisar o orçamento Cedro."},1)).toBeNull();
  await expect(recordCommitmentOutcome(user,saved.id,{source_message_id:reportId,outcome:"Enviei o orçamento Cedro e foi aprovado."},await revision())).rejects.toThrow();
  const rows=await withTenant(other,db=>db.query("SELECT id FROM coach_commitments"));expect(rows.rows).toEqual([]);
 });
 test("revision changes preserve the writing job while invalidating older generated work",async()=>{
  const title="Vou preparar o relatório Delta.",source_message_id=await message(title),before=await revision(),runId=randomUUID();
  await admin.query("INSERT INTO coach_jobs(id,user_id,kind,idempotency_key,status,profile_revision,lease_token,lease_until) VALUES($1,$2,'chat','fixture-current-job','running',$3,$4,now()+interval '15 minutes')",[runId,user,before,randomUUID()]);
  const input={accepted:true as const,title,source_message_id,idempotency_key:"track:"+runId+":0"};
  const saved=await trackCommitment(user,input,before,runId);
  expect(saved.profile_revision).toBe(before+1);
  expect((await admin.query("SELECT profile_revision FROM coach_jobs WHERE id=$1",[runId])).rows[0].profile_revision).toBe(before+1);
  await expect(updateCommitment(user,saved.id,{status:"completed"},before)).rejects.toBeInstanceOf(StaleCoachRunError);
  expect((await listCommitments(user)).find(c=>c.id===saved.id)?.status).toBe("open");
  expect((await trackCommitment(user,input,before,runId)).profile_revision).toBe(before+1);expect(await revision()).toBe(before+1);
  // An unrelated user edit lands after the receipt has returned. It must not be
  // silently adopted by the remaining actions or a replay of the earlier job.
  await admin.query("UPDATE coach_profiles SET revision=revision+1,context='New user context' WHERE user_id=$1",[user]);
  expect(saved.profile_revision).toBe(before+1);
  await expect(updateCommitment(user,saved.id,{status:"completed"},saved.profile_revision,runId)).rejects.toBeInstanceOf(StaleCoachRunError);
  await expect(trackCommitment(user,input,before,runId)).rejects.toBeInstanceOf(StaleCoachRunError);
  await admin.query("UPDATE coach_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,profile_revision=$2 WHERE id=$1",[runId,before+2]);
  await expect(trackCommitment(user,input,before,runId)).rejects.toBeInstanceOf(StaleCoachRunError);
  expect((await trackCommitment(user,input,before)).profile_revision).toBe(before+2);
  expect(await revision()).toBe(before+2);
 });
 test("deleted tasks remain unknown and cannot impersonate intentional taskless tracking",async()=>{
  const source_message_id=await message("Crie uma tarefa para confirmar a reunião Estrela.");
  const saved=await createCommitment(user,{accepted:true,source_message_id,idempotency_key:"fixture:deleted-task:0",title:"Confirmar a reunião Estrela"},await revision());
  await admin.query("DELETE FROM tarefas WHERE id=$1",[saved.tarefa_id]);
  expect((await listCommitments(user)).find(c=>c.id===saved.id)?.status).toBe("unknown");
  await expect(createCommitment(user,{accepted:true,source_message_id,idempotency_key:"track:reserved-key:0",title:"Confirmar a reunião Estrela"},await revision())).rejects.toThrow();
 });
 test("renegotiating without an exact date clears stale commitment and task deadlines",async()=>{
  const source_message_id=await message("Crie uma tarefa para enviar a proposta Horizonte.");
  const saved=await createCommitment(user,{accepted:true,source_message_id,idempotency_key:"fixture:horizonte:task",title:"Enviar a proposta Horizonte",due_at:"2026-09-21T17:00:00Z"},await revision());
  const literal="Reagende a proposta Horizonte para amanhã.";
  const changed=await updateCommitment(user,saved.id,{status:"renegotiated",outcome:literal,due_at:null},await revision());
  expect(changed).toMatchObject({status:"renegotiated",outcome:literal,outcome_source:"user_report",due_at:null});
  expect(changed?.history.at(-1)).toMatchObject({status:"open",outcome:null});
  const task=(await admin.query("SELECT status,prazo,concluida_em,cancelada_em FROM tarefas WHERE id=$1",[saved.tarefa_id])).rows[0];
  expect(task).toMatchObject({status:"aberta",prazo:null,concluida_em:null,cancelada_em:null});
 });
});

import { beforeAll,afterAll,describe,test,expect } from "bun:test";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {getPool,withTenant} from "../db";
import {enqueueJob,listJobs,claimJob,finishJob,cancelJobs,retryJob} from "./jobs";
const connection=process.env.COACH_TEST_DATABASE_URL;
describe.skipIf(!connection)("durable jobs: real isolation and crash recovery",()=>{
 const a=randomUUID(),b=randomUUID(),schema=`jobs_test_${randomUUID().replaceAll("-","")}`;let admin:Pool;
 beforeAll(async()=>{
  const url=new URL(connection!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.pathname!=="/coach_test")throw new Error("Only local coach_test allowed");
  admin=new Pool({connectionString:connection,max:1,options:`-c search_path=${schema}`});
  await admin.query(`CREATE SCHEMA ${schema};GRANT USAGE ON SCHEMA ${schema} TO app_tenant,app_writer;`);
  await admin.query(`CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,nome text,deleted_at timestamptz,consent_terms_at timestamptz);
   CREATE TABLE IF NOT EXISTS coach_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,role text,content text,idempotency_key text);
   ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS idempotency_key text;GRANT SELECT ON coach_messages TO app_tenant,app_writer;
   CREATE TABLE IF NOT EXISTS coach_profiles(user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,enabled boolean NOT NULL DEFAULT false,revision int NOT NULL DEFAULT 1,updated_at timestamptz DEFAULT now());
   ALTER TABLE coach_profiles ENABLE ROW LEVEL SECURITY;ALTER TABLE coach_profiles FORCE ROW LEVEL SECURITY;
   DROP POLICY IF EXISTS jobs_test_tenant ON coach_profiles;
   CREATE POLICY jobs_test_tenant ON coach_profiles USING(user_id::text=current_setting('app.current_user_id',true));
   GRANT USAGE ON SCHEMA public TO app_tenant,app_writer;GRANT SELECT,INSERT,UPDATE,DELETE ON coach_profiles TO app_tenant,app_writer;`);
  const migration=await readFile(new URL("../../../db/0030_coach_jobs.sql",import.meta.url),"utf8");await admin.query(migration);await admin.query(migration);
  await admin.query("INSERT INTO users(id,nome) VALUES($1,'Job A'),($2,'Job B')",[a,b]);
  await admin.query("INSERT INTO coach_profiles(user_id,enabled) VALUES($1,true),($2,true)",[a,b]);
  await global.__pgPool?.end();global.__pgPool=undefined;url.username="app_tenant";url.password="";url.searchParams.set("options",`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
 });
 afterAll(async()=>{await admin?.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[[a,b]]);await global.__pgPool?.end();global.__pgPool=undefined;await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin?.end();});
 test("duplicate requests share identity; no cross-user payload or mutation",async()=>{
  const input={kind:"chat" as const,key:"first",payload:{message:"private A"}};
  const [one,two]=await Promise.all([enqueueJob(a,input),enqueueJob(a,input)]);expect(one.id).toBe(two.id);
  expect(await listJobs(b)).toEqual([]);expect(await getPool().query("SELECT id FROM coach_jobs").then(r=>r.rows)).toEqual([]);
  expect(await cancelJobs(b,one.id)).toBe(0);expect(JSON.stringify(await listJobs(a))).not.toContain("private A");
  await expect(withTenant(a,db=>db.query("INSERT INTO coach_jobs(user_id,kind,idempotency_key,profile_revision) VALUES($1,'analyze','cross',1)",[b]))).rejects.toThrow();
 });
 test("concurrent workers claim once and stale token cannot finish",async()=>{
  const [one,two]=await Promise.all([claimJob(a),claimJob(a)]);expect([one,two].filter(Boolean)).toHaveLength(1);
  const job=one||two!;expect(job.payload.message).toBe("private A");
  expect(await finishJob(a,job.id,randomUUID())).toBe(false);
  expect(await finishJob(b,job.id,job.lease_token)).toBe(false);
  expect(await finishJob(a,job.id,job.lease_token)).toBe(true);
  expect((await listJobs(a))[0].status).toBe("succeeded");
 });
 test("expired lease resumes same job, bounded attempts then explicit retry",async()=>{
  const queued=await enqueueJob(a,{kind:"chat",key:"resume",payload:{message:"Resume"}});
  let lastToken="";
  for(let i=1;i<=3;i++){
   const job=await claimJob(a);expect(job?.id).toBe(queued.id);expect(job?.attempts).toBe(i);expect(job?.lease_token).not.toBe(lastToken);lastToken=job!.lease_token;
   await admin.query("UPDATE coach_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[queued.id]);
  }
  expect(await claimJob(a)).toBeNull();expect((await listJobs(a))[0].status).toBe("failed");
  expect(await retryJob(b,queued.id)).toBe(false);expect(await retryJob(a,queued.id)).toBe(true);
  const next=await claimJob(a);expect(next?.id).toBe(queued.id);expect(next?.attempts).toBe(1);
  await finishJob(a,next!.id,next!.lease_token,{error:"Interrompido",retry:true});expect((await listJobs(a))[0].status).toBe("queued");expect(await claimJob(a)).toBeNull();
  await cancelJobs(a);
 });
 test("committed reply can finish a legitimate profile transition without reviving cancellation",async()=>{
  await admin.query("UPDATE coach_profiles SET enabled=true WHERE user_id=$1",[b]);
  const queued=await enqueueJob(b,{kind:"chat",key:"goal-change",payload:{message:"Change goal"}});const job=await claimJob(b);
  await admin.query("UPDATE coach_profiles SET revision=revision+1 WHERE user_id=$1",[b]);
  expect(await claimJob(b)).toBeNull();expect((await listJobs(b))[0].status).toBe("running");
  expect(await finishJob(b,job!.id,job!.lease_token)).toBe(false);
  await admin.query("INSERT INTO coach_messages(user_id,role,content,idempotency_key) VALUES($1,'assistant','Recorded',$2)",[b,`${queued.id}:assistant`]);
  expect(await finishJob(b,job!.id,job!.lease_token)).toBe(true);
 });
 test("failed jobs can be dismissed explicitly without changing the profile or erasing other failures",async()=>{
  const job=await enqueueJob(b,{kind:"chat",key:"dismiss",payload:{message:"Dismiss"}});const running=await claimJob(b);
  await finishJob(b,running!.id,running!.lease_token,{error:"Failed"});
  const revision=(await admin.query("SELECT revision FROM coach_profiles WHERE user_id=$1",[b])).rows[0].revision;
  await cancelJobs(b);expect((await listJobs(b)).find(j=>j.id===job.id)?.status).toBe("failed");
  expect(await cancelJobs(a,job.id)).toBe(0);
  expect(await cancelJobs(b,job.id)).toBe(1);expect((await listJobs(b)).find(j=>j.id===job.id)?.status).toBe("cancelled");
  expect((await admin.query("SELECT revision FROM coach_profiles WHERE user_id=$1",[b])).rows[0].revision).toBe(revision);
 });
 test("cancelling in-flight work invalidates source revision and pause prevents claiming",async()=>{
  const queued=await enqueueJob(a,{kind:"chat",key:"cancel",payload:{message:"cancel"}});const job=await claimJob(a);expect(job?.id).toBe(queued.id);
  await cancelJobs(a,queued.id);expect(await finishJob(a,job!.id,job!.lease_token)).toBe(false);
  expect((await admin.query("SELECT revision FROM coach_profiles WHERE user_id=$1",[a])).rows[0].revision).toBe(2);
  await enqueueJob(a,{kind:"analyze",key:"pause"});await admin.query("UPDATE coach_profiles SET enabled=false,revision=revision+1 WHERE user_id=$1",[a]);
  expect(await claimJob(a)).toBeNull();expect((await listJobs(a))[0].status).toBe("cancelled");
  await expect(enqueueJob(a,{kind:"analyze",key:"paused"})).rejects.toThrow("Ative");
 });
});

import { afterAll,beforeAll,describe,expect,test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { withTenant } from "../db";
import { calendarRepository,clearCalendarSnapshot,createCalendarAccess } from "./calendar";

const connection=process.env.COACH_TEST_DATABASE_URL;
describe.skipIf(!connection)("calendar real Postgres isolation and invalidation",()=>{
 const user=randomUUID(),other=randomUUID(),schema="calendar_"+randomUUID().replaceAll("-","");
 const range={from:"2026-09-20T00:00:00Z",to:"2026-09-27T00:00:00Z"};
 const snapshot={version:1 as const,status:"connected" as const,...range,updated_at:new Date().toISOString(),limitations:[],events:[{id:"event",subject:"PRIVATE_AGENDA_FIXTURE",start:"2026-09-20T13:00:00Z",end:"2026-09-20T14:00:00Z",show_as:"busy",is_private:true,is_all_day:false}]};
 let admin:Pool;let original:string|undefined;
 beforeAll(async()=>{
  const url=new URL(connection!);if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.pathname!=="/coach_test")throw new Error("Local dedicated coach_test database required");
  admin=new Pool({connectionString:connection,max:1});await admin.query(`CREATE SCHEMA ${schema};SET search_path=${schema};GRANT USAGE ON SCHEMA ${schema} TO app_tenant,app_writer;CREATE TABLE users(id uuid PRIMARY KEY);CREATE TABLE meetings(id uuid,user_id uuid,PRIMARY KEY(id,user_id));`);
  await admin.query(await readFile(new URL("../../../db/0028_leadership_coach.sql",import.meta.url),"utf8"));
  const migration=await readFile(new URL("../../../db/0032_coach_calendar_cache.sql",import.meta.url),"utf8");await admin.query(migration);await admin.query(migration);
  await admin.query("INSERT INTO users(id) VALUES($1),($2);",[user,other]);
  await admin.query("INSERT INTO coach_profiles(user_id,enabled) VALUES($1,true),($2,true)",[user,other]);
  original=process.env.DATABASE_URL;await global.__pgPool?.end();global.__pgPool=undefined;
  url.username="app_tenant";url.password="";url.searchParams.set("options",`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
 });
 afterAll(async()=>{await global.__pgPool?.end();global.__pgPool=undefined;if(original===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=original;await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin?.end();});
 test("forced RLS denies reading or inserting another person's copied agenda",async()=>{
  const token=randomUUID();const revision=await calendarRepository.claim(user,range,token);expect(revision).toBe(1);
  expect(await calendarRepository.save(user,token,revision!,snapshot,null)).toBe(true);
  expect((await calendarRepository.read(user)).row?.snapshot?.events[0].subject).toBe("PRIVATE_AGENDA_FIXTURE");
  expect((await withTenant(other,db=>db.query("SELECT * FROM coach_calendar_cache"))).rows).toEqual([]);
  await expect(withTenant(other,db=>db.query("INSERT INTO coach_calendar_cache(user_id) VALUES($1)",[user]))).rejects.toThrow();
  const rls=(await admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",[`${schema}.coach_calendar_cache`])).rows[0];expect(rls).toEqual({relrowsecurity:true,relforcerowsecurity:true});
 });
 test("the DB lease serializes refresh and a preference change invalidates pending HTTP",async()=>{
  const token=randomUUID();const revision=await calendarRepository.claim(user,range,token);expect(revision).not.toBeNull();expect(await calendarRepository.claim(user,range,randomUUID())).toBeNull();
  await calendarRepository.setEnabled(user,false);expect(await calendarRepository.save(user,token,revision!,snapshot,null)).toBe(false);expect((await calendarRepository.read(user)).row?.snapshot).toBeNull();expect(await calendarRepository.claim(user,range,randomUUID())).toBeNull();
 });
 test("clear plus profile revision protects erasure from pending refresh",async()=>{
  await calendarRepository.setEnabled(user,true);const token=randomUUID();const revision=await calendarRepository.claim(user,range,token);
  await withTenant(user,db=>db.query("UPDATE coach_profiles SET enabled=false,revision=revision+1 WHERE user_id=$1",[user]));await calendarRepository.clear(user);
  expect(await calendarRepository.save(user,token,revision!,snapshot,null)).toBe(false);expect((await calendarRepository.read(user)).row).toBeNull();
 });
 test("pausing removes copied data while preserving a separately paused agenda preference",async()=>{
  await calendarRepository.setEnabled(user,false);await clearCalendarSnapshot(user);expect((await calendarRepository.read(user)).row?.enabled).toBe(false);
  await withTenant(user,db=>db.query("UPDATE coach_profiles SET enabled=true WHERE user_id=$1",[user]));
  const access=createCalendarAccess(calendarRepository,{config:()=>({baseUrl:"https://example.supabase.co/functions/v1",token:"synthetic",userId:user}),fetch:async()=>{throw new Error("must not fetch");}});
  expect((await access.context(user,range)).status).toBe("paused");expect((await access.context(other,range)).status).toBe("not_configured");
 });
});

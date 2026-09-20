import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { coachStore } from "./store";
import { analyzeMeetings, chatWithCoach, generateReview } from "./service";
// Opt-in paid provider test; only synthetic records in the dedicated local QA DB.
describe.skipIf(process.env.COACH_PROVIDER_TEST!=="1")("coach real provider lifecycle",()=>{
 const userId=randomUUID(),meetingId=randomUUID(),personId=randomUUID();let admin:Pool;
 const store=coachStore(userId);
 beforeAll(async()=>{
  const url=new URL(process.env.DATABASE_URL||"");
  if(!["localhost","127.0.0.1"].includes(url.hostname)||url.pathname!=="/coach_qa")throw new Error("Only local coach_qa is allowed");
  url.username=process.env.USER||"vitorgambetti";url.password="";admin=new Pool({connectionString:url.toString()});
  await admin.query("INSERT INTO users(id,nome,consent_terms_at) VALUES($1,'Coach provider fixture',now())",[userId]);
  await admin.query("INSERT INTO pessoas(id,user_id,nome,is_vitor) VALUES($1,$2,'Coach provider fixture',true)",[personId,userId]);
  const transcript="Vou pausar dois projetos e definir um responsável. O foco desta semana será concluir a proposta. Na sexta vamos revisar o resultado.";
  await admin.query(`INSERT INTO meetings(id,user_id,source,original_filename,nome,recorded_at,status,transcription,segments,speaker_labels,speaker_pessoas)
  VALUES($1,$2,'macbook','synthetic.mp3','Exemplo fictício','2026-09-17T12:00:00Z','done',$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
  [meetingId,userId,transcript,JSON.stringify([{speaker:"A",start:0,end:30,text:transcript}]),JSON.stringify({A:"Coach provider fixture"}),JSON.stringify({A:personId})]);
  await store.saveProfile({enabled:true,weekly_enabled:true,review_day:5,review_hour:17,goals:"Concluir uma prioridade semanal antes de assumir outra frente."});
 });
 afterAll(async()=>{await admin?.query("DELETE FROM meetings WHERE user_id=$1",[userId]);await admin?.query("DELETE FROM pessoas WHERE user_id=$1",[userId]);await admin?.query("DELETE FROM users WHERE id=$1",[userId]);await admin?.end();await global.__pgPool?.end();global.__pgPool=undefined;});
 test("analysis, grounded weekly review and contextual conversation persist",async()=>{
  expect((await analyzeMeetings(userId,1)).processed).toBe(1);
  expect((await store.coverage()).pending_meetings).toBe(0);
  const analyses=await store.analyses(meetingId);expect(analyses).toHaveLength(1);
  expect(analyses[0].observations.length).toBeGreaterThan(0);
  const review=await generateReview(userId,new Date("2026-09-20T20:00:00Z"));
  if(!review)throw new Error("manual review must be generated");
  expect(review.content.observations.length).toBeGreaterThan(0);
  expect(review.content.observations.length).toBeLessThanOrEqual(2);
  expect(review.content.observations.every(o=>o.experiment==="")).toBe(true);
  expect(review.content.experiment.length).toBeGreaterThan(0);
  expect(review.content.headline.length).toBeLessThanOrEqual(100);
  for(const o of review.content.observations)for(const e of o.evidence){expect(e.meeting_id).toBe(meetingId);expect(e.self_attributed).toBe(true);}
  expect((await generateReview(userId,new Date("2026-09-20T20:00:00Z")))?.id).toBe(review.id);
  await chatWithCoach(userId,"Qual comportamento meu merece acompanhamento nesta reunião? Use uma evidência e sugira um experimento.");
  const history=await store.messages();expect(history).toHaveLength(2);expect(history[1].role).toBe("assistant");expect(history[1].content.length).toBeGreaterThan(50);expect(history[1].evidence.length).toBeGreaterThan(0);
  for(const label of ["**Observação:**","**Hipótese:**","**Outra explicação:**"])expect(history[1].content).toContain(label);
  expect(history[1].content).toContain("1 trecho de 1 reunião");
  expect(history[1].content).toContain("1 de 1 reunião do histórico com análise completa");
  expect(history[1].content).not.toMatch(/\be\d+\b/);
 },180000);
});
